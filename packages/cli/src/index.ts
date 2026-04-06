#!/usr/bin/env node
import { program } from "commander";
import { resolve } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import {
  loadConfig,
  ModelRouter,
  ToolRegistry,
  PermissionGate,
  HookRunner,
  ContextLoader,
  MemoryManager,
  createSession,
  loadSavedSession,
  agentLoop,
  saveSession,
  buildSystemPrompt,
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  BashTool,
  WebFetchTool,
  TodoReadTool,
  TodoWriteTool,
} from "@supercode/core";
import { createSubAgentTool } from "@supercode/core";
import { startRepl } from "./repl.js";
import { TerminalRenderer } from "./display/renderer.js";
import type { PermissionMode, ToolCall } from "@supercode/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
let VERSION = "0.1.0";
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
  VERSION = pkg.version;
} catch {}

function buildRuntime(config: ReturnType<typeof loadConfig>, workingDir: string) {
  const router = new ModelRouter(config);

  // Load context
  const contextLoader = new ContextLoader();
  const projectContext = contextLoader.loadProjectContext(workingDir);
  const memoryManager = new MemoryManager(workingDir);
  const memory = memoryManager.formatForContext();

  // Build registry
  const registry = new ToolRegistry();

  // Build hooks
  const hooks = new HookRunner();
  const hooksDir = join(workingDir, ".supercode", "hooks");
  hooks.load(hooksDir);

  // Build gate with approval callback
  const renderer = new TerminalRenderer();
  const gate = new PermissionGate(config, async (call: ToolCall, desc: string) => {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise<boolean>((resolve) => {
      rl.question(
        `\n⚠  Tool "${call.name}" requires approval:\n${desc}\n\nAllow? [y/N] `,
        (answer) => {
          rl.close();
          resolve(answer.toLowerCase() === "y");
        }
      );
    });
  });

  // Register all tools
  const allTools = [
    ReadTool, WriteTool, EditTool, GlobTool, GrepTool,
    BashTool, WebFetchTool, TodoReadTool, TodoWriteTool,
  ];
  registry.registerAll(allTools);

  // Register SubAgent with runtime bound
  const subAgentTool = createSubAgentTool({ router, registry, gate, hooks, config });
  registry.register(subAgentTool);

  const systemPrompt = buildSystemPrompt({ workingDirectory: workingDir, projectContext, memory });

  return { router, registry, gate, hooks, systemPrompt, renderer };
}

program
  .name("supercode")
  .version(VERSION)
  .description("Multi-model CLI coding agent — Gemini, Codex, OpenRouter, and more")
  .argument("[prompt]", "Single-shot prompt (omit for interactive REPL)")
  .option("-m, --model <model>", "Model to use (overrides config)")
  .option("--mode <mode>", "Permission mode: default|acceptEdits|plan|dontAsk", "default")
  .option("--max-turns <n>", "Maximum agent loop turns", "100")
  .option("--max-cost <dollars>", "Max cost per session in USD", "0.50")
  .option("--resume <sessionId>", "Resume a previous session")
  .option("--print", "Print mode — no tools, just model output")
  .option("-d, --dir <path>", "Working directory", process.cwd())
  .action(async (prompt: string | undefined, opts) => {
    const config = loadConfig();
    const workingDir = resolve(opts.dir);
    const renderer = new TerminalRenderer();

    const { router, registry, gate, hooks, systemPrompt } = buildRuntime(config, workingDir);

    // Apply CLI overrides
    if (opts.model) router.setCurrentModel(opts.model);
    if (opts.maxCost) {
      config.costs.maxPerSessionCents = Math.round(parseFloat(opts.maxCost) * 100);
    }

    // Resume session
    let resumedMessages: import("@supercode/core").Message[] = [];
    if (opts.resume) {
      const saved = loadSavedSession(opts.resume);
      if (saved) {
        resumedMessages = saved.messages;
        renderer.printInfo(`Resumed session: ${opts.resume}`);
      } else {
        renderer.printError(`Session not found: ${opts.resume}`);
      }
    }

    const session = createSession({
      workingDirectory: workingDir,
      mode: opts.mode as PermissionMode,
      maxTurns: parseInt(opts.maxTurns, 10),
      tools: registry.getAll(),
      systemPrompt,
      model: opts.model,
    });

    session.messages = resumedMessages;

    // Print mode — pipe stdin, no tools
    if (opts.print) {
      const inputText = prompt ?? (await readStdin());
      session.messages.push({ role: "user", content: inputText });
      session.tools = []; // no tools in print mode

      for await (const event of agentLoop(session, { router, registry: { ...registry, getAll: () => [] } as any, gate, hooks })) {
        if (event.type === "assistant_text") process.stdout.write(event.text ?? "");
        if (event.type === "done" || event.type === "error") break;
      }
      process.stdout.write("\n");
      return;
    }

    // Single-shot mode
    if (prompt) {
      session.messages.push({ role: "user", content: prompt });
      for await (const event of agentLoop(session, { router, registry, gate, hooks })) {
        renderer.renderEvent(event);
        if (event.type === "done" || event.type === "error") break;
      }
      saveSession(session);
      renderer.printCost(router.costTracker.summary());
      return;
    }

    // Check for stdin pipe
    if (!process.stdin.isTTY) {
      const inputText = await readStdin();
      if (inputText.trim()) {
        session.messages.push({ role: "user", content: inputText });
        for await (const event of agentLoop(session, { router, registry, gate, hooks })) {
          renderer.renderEvent(event);
          if (event.type === "done" || event.type === "error") break;
        }
        saveSession(session);
        renderer.printCost(router.costTracker.summary());
        return;
      }
    }

    // Interactive REPL
    await startRepl({ session, router, registry, gate, hooks });
  });

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

program.parse();
