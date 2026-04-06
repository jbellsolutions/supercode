import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { randomUUID } from "crypto";

import {
  loadConfig,
  ModelRouter,
  ToolRegistry,
  PermissionGate,
  HookRunner,
  ContextLoader,
  MemoryManager,
  createSession,
  saveSession,
  loadSavedSession,
  listSessions,
  agentLoop,
  buildSystemPrompt,
  createSubAgentTool,
  ReadTool, WriteTool, EditTool, GlobTool, GrepTool,
  BashTool, WebFetchTool, TodoReadTool, TodoWriteTool,
} from "@supercode/core";
import type { PermissionMode, AgentEvent, ToolCall, Session } from "@supercode/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT ?? "4242", 10);

// ── Server setup ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "../src/public")));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// ── State ────────────────────────────────────────────────────────────────────
interface ClientState {
  ws: WebSocket;
  session?: Session;
  router?: ModelRouter;
  registry?: ToolRegistry;
  gate?: PermissionGate;
  hooks?: HookRunner;
  pendingApproval?: {
    resolve: (v: boolean) => void;
    call: ToolCall;
  };
}

const clients = new Map<string, ClientState>();

// ── REST endpoints ────────────────────────────────────────────────────────────
app.get("/api/config", (_req, res) => {
  const config = loadConfig();
  res.json({
    models: config.models,
    providers: {
      gemini: { configured: !!config.providers.gemini?.apiKey },
      openai: { configured: !!config.providers.openai?.apiKey },
      openrouter: { configured: !!config.providers.openrouter?.apiKey },
    },
    costs: config.costs,
    permissions: config.permissions,
  });
});

app.get("/api/sessions", (_req, res) => {
  res.json(listSessions());
});

// ── WebSocket handler ─────────────────────────────────────────────────────────
wss.on("connection", (ws) => {
  const clientId = randomUUID();
  const state: ClientState = { ws };
  clients.set(clientId, state);

  send(ws, { type: "connected", clientId });

  ws.on("message", async (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "init":
        handleInit(clientId, state, msg);
        break;
      case "chat":
        handleChat(clientId, state, msg);
        break;
      case "approval":
        handleApproval(state, msg);
        break;
      case "command":
        handleCommand(state, msg);
        break;
      case "resume":
        handleResume(clientId, state, msg);
        break;
    }
  });

  ws.on("close", () => {
    if (state.session) {
      try { saveSession(state.session); } catch {}
    }
    clients.delete(clientId);
  });
});

// ── Handlers ──────────────────────────────────────────────────────────────────
function handleInit(clientId: string, state: ClientState, msg: Record<string, unknown>) {
  const config = loadConfig();
  const workingDir = resolve((msg.workingDir as string) ?? process.cwd());
  const mode = (msg.mode as PermissionMode) ?? config.permissions.defaultMode;
  const model = (msg.model as string) ?? undefined;

  const router = new ModelRouter(config);
  if (model) router.setCurrentModel(model);

  const registry = new ToolRegistry();
  const hooks = new HookRunner();
  hooks.load(join(workingDir, ".supercode", "hooks"));

  // Gate with WS-based approval
  const gate = new PermissionGate(config, async (call: ToolCall, desc: string) => {
    return new Promise<boolean>((resolve) => {
      state.pendingApproval = { resolve, call };
      send(state.ws, { type: "approval_request", call, description: desc });
    });
  });

  const allTools = [ReadTool, WriteTool, EditTool, GlobTool, GrepTool,
                    BashTool, WebFetchTool, TodoReadTool, TodoWriteTool];
  registry.registerAll(allTools);
  registry.register(createSubAgentTool({ router, registry, gate, hooks, config }));

  const contextLoader = new ContextLoader();
  const projectContext = contextLoader.loadProjectContext(workingDir);
  const memory = new MemoryManager(workingDir).formatForContext();
  const systemPrompt = buildSystemPrompt({ workingDirectory: workingDir, projectContext, memory });

  state.session = createSession({
    workingDirectory: workingDir,
    mode,
    maxTurns: (msg.maxTurns as number) ?? 100,
    tools: registry.getAll(),
    systemPrompt,
    model,
  });

  state.router = router;
  state.registry = registry;
  state.gate = gate;
  state.hooks = hooks;

  send(state.ws, {
    type: "session_created",
    sessionId: state.session.id,
    model: router.getCurrentModel(),
    mode,
    workingDir,
  });
}

function handleResume(clientId: string, state: ClientState, msg: Record<string, unknown>) {
  const sessionId = msg.sessionId as string;
  const saved = loadSavedSession(sessionId);
  if (!saved) {
    send(state.ws, { type: "error", message: `Session not found: ${sessionId}` });
    return;
  }
  // Re-init with same settings then replay history
  handleInit(clientId, state, { workingDir: saved.workingDirectory, mode: saved.mode, model: saved.model });
  if (state.session) {
    state.session.messages = saved.messages;
    send(state.ws, { type: "resumed", sessionId, messageCount: saved.messages.length });
  }
}

async function handleChat(clientId: string, state: ClientState, msg: Record<string, unknown>) {
  if (!state.session || !state.router || !state.registry || !state.gate || !state.hooks) {
    send(state.ws, { type: "error", message: "Session not initialized. Send an init message first." });
    return;
  }

  const prompt = msg.prompt as string;
  if (!prompt?.trim()) return;

  state.session.messages.push({ role: "user", content: prompt });

  send(state.ws, { type: "thinking" });

  try {
    for await (const event of agentLoop(state.session, {
      router: state.router,
      registry: state.registry,
      gate: state.gate,
      hooks: state.hooks,
    })) {
      send(state.ws, { type: "agent_event", event });
      if (event.type === "done" || event.type === "error") break;
    }
  } catch (err: unknown) {
    send(state.ws, { type: "error", message: err instanceof Error ? err.message : String(err) });
  }

  send(state.ws, {
    type: "cost_update",
    summary: state.router.costTracker.summary(),
    totalCents: state.router.costTracker.totalCents,
  });

  try { saveSession(state.session); } catch {}
}

function handleApproval(state: ClientState, msg: Record<string, unknown>) {
  if (!state.pendingApproval) return;
  state.pendingApproval.resolve(msg.approved as boolean);
  state.pendingApproval = undefined;
}

function handleCommand(state: ClientState, msg: Record<string, unknown>) {
  const cmd = msg.command as string;

  switch (cmd) {
    case "set_model":
      if (state.router && msg.model) {
        state.router.setCurrentModel(msg.model as string);
        if (state.session) state.session.model = msg.model as string;
        send(state.ws, { type: "model_changed", model: msg.model });
      }
      break;
    case "set_mode":
      if (state.session && msg.mode) {
        state.session.mode = msg.mode as PermissionMode;
        send(state.ws, { type: "mode_changed", mode: msg.mode });
      }
      break;
    case "clear_history":
      if (state.session) {
        state.session.messages = [];
        send(state.ws, { type: "history_cleared" });
      }
      break;
    case "get_cost":
      if (state.router) {
        send(state.ws, { type: "cost_update", summary: state.router.costTracker.summary() });
      }
      break;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function send(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n  SuperCode Dashboard running at http://localhost:${PORT}\n`);
});
