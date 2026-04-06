import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const schema = z.object({
  path: z.string().describe("Path to write to"),
  content: z.string().describe("Content to write"),
  createDirs: z.boolean().optional().default(true).describe("Create parent directories if missing"),
});

export const WriteTool: Tool = {
  name: "Write",
  description: "Create or overwrite a file with the given content.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to write to" },
      content: { type: "string", description: "Content to write" },
      createDirs: { type: "boolean", description: "Create parent directories if missing", default: true },
    },
    required: ["path", "content"],
  },
  requiresPermission: true,

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, output: "", error: parsed.error.message };

    const { path, content, createDirs } = parsed.data;
    const abs = resolve(ctx.workingDirectory, path);

    try {
      if (createDirs) mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf-8");
      return { success: true, output: `Written ${content.length} bytes to ${abs}` };
    } catch (err: unknown) {
      return { success: false, output: "", error: String(err) };
    }
  },
};
