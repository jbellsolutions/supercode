import * as readline from "readline";
import { agentLoop, saveSession } from "@supercode/core";
import type { Session, AgentEvent } from "@supercode/core";
import type { ModelRouter } from "@supercode/core";
import type { ToolRegistry } from "@supercode/core";
import type { PermissionGate } from "@supercode/core";
import type { HookRunner } from "@supercode/core";
import { handleCommand } from "./commands/index.js";
import { TerminalRenderer } from "./display/renderer.js";

export interface ReplOptions {
  session: Session;
  router: ModelRouter;
  registry: ToolRegistry;
  gate: PermissionGate;
  hooks: HookRunner;
}

export async function startRepl(opts: ReplOptions): Promise<void> {
  const { session, router, registry, gate, hooks } = opts;
  const renderer = new TerminalRenderer();

  const VERSION = "0.1.0";
  renderer.printWelcome(VERSION, router.getCurrentModel());

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const promptUser = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(renderer.prompt(router.getCurrentModel()), (answer) => {
        resolve(answer.trim());
      });
    });
  };

  const cmdCtx = { session, router, renderer };

  while (true) {
    let input: string;
    try {
      input = await promptUser();
    } catch {
      // EOF / Ctrl-D
      break;
    }

    if (!input) continue;

    // Handle /commands
    if (input.startsWith("/")) {
      const result = await handleCommand(input, cmdCtx);
      if (result?.type === "exit") break;
      continue;
    }

    // Regular message — run through agent loop
    session.messages.push({ role: "user", content: input });

    try {
      for await (const event of agentLoop(session, { router, registry, gate, hooks })) {
        renderer.renderEvent(event);
        if (event.type === "done" || event.type === "error") break;
      }
    } catch (err: unknown) {
      renderer.printError(err instanceof Error ? err.message : String(err));
    }

    // Auto-save session
    try {
      saveSession(session);
    } catch {}

    console.log(); // blank line between turns
  }

  rl.close();
  renderer.printInfo(`Session ${session.id} ended. ${router.costTracker.summary()}`);
}
