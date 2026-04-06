import { execa } from "execa";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const schema = z.object({
  command: z.string().describe("Shell command to execute"),
  timeout: z.number().optional().default(30000).describe("Timeout in milliseconds (default 30s)"),
  cwd: z.string().optional().describe("Working directory for the command"),
});

export const BashTool: Tool = {
  name: "Bash",
  description:
    "Execute a shell command and return its output. Use for running tests, builds, git operations, etc.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      timeout: { type: "number", description: "Timeout in milliseconds", default: 30000 },
      cwd: { type: "string", description: "Working directory for the command" },
    },
    required: ["command"],
  },
  requiresPermission: true,

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, output: "", error: parsed.error.message };

    const { command, timeout, cwd } = parsed.data;
    const workDir = cwd ?? ctx.workingDirectory;

    try {
      const result = await execa("bash", ["-c", command], {
        cwd: workDir,
        timeout,
        reject: false,
        all: true,
      });

      const output = result.all ?? result.stdout ?? "";
      const exitCode = result.exitCode ?? 0;

      if (exitCode !== 0) {
        return {
          success: false,
          output,
          error: `Command exited with code ${exitCode}\n${result.stderr}`,
        };
      }

      return { success: true, output: output || "(no output)" };
    } catch (err: unknown) {
      return { success: false, output: "", error: String(err) };
    }
  },
};
