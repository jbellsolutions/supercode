import { createSession } from "./session.js";
import { agentLoop } from "./loop.js";
import type { Tool, ToolContext, ToolResult, PermissionMode, AgentEvent } from "../types.js";
import type { ModelRouter } from "../router/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { PermissionGate } from "../permissions/gate.js";
import type { HookRunner } from "../permissions/hooks.js";
import type { SupercodeConfig } from "../config/index.js";
import { buildSystemPrompt } from "./loop.js";

export interface SubAgentRuntime {
  router: ModelRouter;
  registry: ToolRegistry;
  gate: PermissionGate;
  hooks: HookRunner;
  config: SupercodeConfig;
}

export function createSubAgentTool(runtime: SubAgentRuntime): Tool {
  return {
    name: "SubAgent",
    description:
      "Spawn a child agent to handle a discrete sub-task independently. Returns the sub-agent's final output.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Task for the sub-agent" },
        model: { type: "string", description: "Model to use" },
        mode: { type: "string", enum: ["default", "acceptEdits", "plan", "dontAsk"] },
        maxTurns: { type: "number", default: 20 },
        workingDirectory: { type: "string" },
      },
      required: ["prompt"],
    },
    requiresPermission: true,

    async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
      const { prompt, model, mode, maxTurns, workingDirectory } =
        input as {
          prompt: string;
          model?: string;
          mode?: PermissionMode;
          maxTurns?: number;
          workingDirectory?: string;
        };

      const subSession = createSession({
        workingDirectory: workingDirectory ?? ctx.workingDirectory,
        mode: mode ?? "default",
        maxTurns: maxTurns ?? 20,
        tools: runtime.registry.getAll(),
        systemPrompt: buildSystemPrompt({ workingDirectory: workingDirectory ?? ctx.workingDirectory }),
        model: model ?? runtime.config.models.subAgent,
      });

      subSession.messages.push({ role: "user", content: prompt });

      const outputParts: string[] = [];

      for await (const event of agentLoop(subSession, {
        router: runtime.router,
        registry: runtime.registry,
        gate: runtime.gate,
        hooks: runtime.hooks,
      })) {
        if (event.type === "assistant_text" && event.text) {
          outputParts.push(event.text);
        } else if (event.type === "error") {
          return { success: false, output: outputParts.join(""), error: event.error };
        }
      }

      return { success: true, output: outputParts.join("") || "(sub-agent produced no output)" };
    },
  };
}
