import { readFileSync, existsSync } from "fs";
import { globSync } from "glob";
import { resolve } from "path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const schema = z.object({
  pattern: z.string().describe("Regular expression to search for"),
  path: z.string().optional().describe("File or directory to search (defaults to working directory)"),
  glob: z.string().optional().describe("Glob to filter files when path is a directory"),
  ignoreCase: z.boolean().optional().default(false),
  contextLines: z.number().optional().default(2).describe("Lines of context around each match"),
});

export const GrepTool: Tool = {
  name: "Grep",
  description: "Search for a regex pattern across files. Returns matching lines with context.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search" },
      path: { type: "string", description: "File or directory to search" },
      glob: { type: "string", description: "Glob pattern to filter files (e.g. '**/*.ts')" },
      ignoreCase: { type: "boolean", default: false },
      contextLines: { type: "number", default: 2 },
    },
    required: ["pattern"],
  },
  requiresPermission: false,

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, output: "", error: parsed.error.message };

    const { pattern, path, glob, ignoreCase, contextLines } = parsed.data;
    const basePath = resolve(ctx.workingDirectory, path ?? ".");
    const regex = new RegExp(pattern, ignoreCase ? "gi" : "g");

    let files: string[];
    try {
      files = globSync(glob ?? "**/*", {
        cwd: basePath,
        absolute: true,
        nodir: true,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      });
    } catch (err) {
      return { success: false, output: "", error: String(err) };
    }

    const results: string[] = [];
    let totalMatches = 0;
    const MAX_MATCHES = 200;

    for (const file of files) {
      if (totalMatches >= MAX_MATCHES) break;
      if (!existsSync(file)) continue;

      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i])) continue;
        regex.lastIndex = 0; // reset stateful regex

        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length - 1, i + contextLines);
        const block = lines.slice(start, end + 1).map((l, j) => {
          const lineNum = start + j + 1;
          const marker = lineNum === i + 1 ? ">" : " ";
          return `${marker} ${file}:${lineNum}: ${l}`;
        });
        results.push(block.join("\n"));
        totalMatches++;
        if (totalMatches >= MAX_MATCHES) break;
      }
    }

    if (results.length === 0) return { success: true, output: "No matches found." };
    if (totalMatches >= MAX_MATCHES) results.push(`\n[Truncated — ${MAX_MATCHES} matches shown]`);
    return { success: true, output: results.join("\n---\n") };
  },
};
