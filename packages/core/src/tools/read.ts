import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const schema = z.object({
  path: z.string().describe("Absolute or relative path to the file to read"),
  offset: z.number().optional().describe("Line number to start reading from (1-based)"),
  limit: z.number().optional().describe("Maximum number of lines to read"),
});

export const ReadTool: Tool = {
  name: "Read",
  description: "Read the contents of a file. Returns the file content as text.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file to read" },
      offset: { type: "number", description: "Line number to start reading from (1-based)" },
      limit: { type: "number", description: "Maximum number of lines to read" },
    },
    required: ["path"],
  },
  requiresPermission: false,

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, output: "", error: parsed.error.message };

    const { path, offset, limit } = parsed.data;
    const abs = resolve(ctx.workingDirectory, path);

    if (!existsSync(abs)) {
      return { success: false, output: "", error: `File not found: ${abs}` };
    }

    try {
      const content = readFileSync(abs, "utf-8");
      let lines = content.split("\n");

      if (offset !== undefined) lines = lines.slice(offset - 1);
      if (limit !== undefined) lines = lines.slice(0, limit);

      const numbered = lines.map((l, i) => `${(offset ?? 1) + i}: ${l}`).join("\n");
      return { success: true, output: numbered };
    } catch (err: unknown) {
      return { success: false, output: "", error: String(err) };
    }
  },
};
