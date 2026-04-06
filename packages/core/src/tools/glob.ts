import { globSync } from "glob";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const schema = z.object({
  pattern: z.string().describe("Glob pattern to match files"),
  path: z.string().optional().describe("Base directory to search in (defaults to working directory)"),
  ignore: z.array(z.string()).optional().describe("Patterns to ignore"),
});

export const GlobTool: Tool = {
  name: "Glob",
  description: "Find files matching a glob pattern. Returns a list of matching file paths.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts')" },
      path: { type: "string", description: "Base directory to search in" },
      ignore: { type: "array", items: { type: "string" }, description: "Patterns to ignore" },
    },
    required: ["pattern"],
  },
  requiresPermission: false,

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, output: "", error: parsed.error.message };

    const { pattern, path, ignore } = parsed.data;
    const cwd = path ? path : ctx.workingDirectory;

    try {
      const matches = globSync(pattern, {
        cwd,
        absolute: true,
        ignore: ignore ?? ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      });

      if (matches.length === 0) {
        return { success: true, output: "No files matched the pattern." };
      }

      return { success: true, output: matches.join("\n") };
    } catch (err: unknown) {
      return { success: false, output: "", error: String(err) };
    }
  },
};
