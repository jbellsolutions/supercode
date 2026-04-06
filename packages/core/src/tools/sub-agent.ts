import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const schema = z.object({
  prompt: z.string().describe("Task for the sub-agent to complete"),
  model: z.string().optional().describe("Model to use for the sub-agent"),
  mode: z.enum(["default", "acceptEdits", "plan", "dontAsk"]).optional().default("default"),
  maxTurns: z.number().optional().default(20),
  workingDirectory: z.string().optional().describe("Working directory for the sub-agent"),
});

/**
 * Sub-agent tool — spawns a child agent with its own isolated loop.
 * The actual spawning is done by the agent loop when it sees this tool call.
 * This file defines the tool schema; the implementation is in agent/subagent.ts.
 */
export const SubAgentTool: Tool = {
  name: "SubAgent",
  description:
    "Spawn a child agent to handle a discrete sub-task. The sub-agent has its own message history and tool execution context. Returns the sub-agent's final output.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Task for the sub-agent" },
      model: { type: "string", description: "Model to use (defaults to subAgent model from config)" },
      mode: { type: "string", enum: ["default", "acceptEdits", "plan", "dontAsk"], default: "default" },
      maxTurns: { type: "number", default: 20 },
      workingDirectory: { type: "string", description: "Override working directory" },
    },
    required: ["prompt"],
  },
  requiresPermission: true,

  // The real implementation is injected at runtime by the agent loop
  // This stub is here so the tool registry can export the schema
  async execute(_input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    return {
      success: false,
      output: "",
      error: "SubAgent.execute must be overridden by the agent runtime.",
    };
  },
};
