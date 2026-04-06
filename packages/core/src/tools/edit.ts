import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const schema = z.object({
  path: z.string().describe("File path to edit"),
  edits: z.array(
    z.object({
      oldString: z.string().describe("The exact string to replace"),
      newString: z.string().describe("The replacement string"),
      replaceAll: z.boolean().optional().default(false),
    })
  ).describe("List of string replacements to apply"),
});

export const EditTool: Tool = {
  name: "Edit",
  description:
    "Make targeted edits to a file by replacing specific strings. Each edit replaces an exact match. Fails if oldString not found (or not unique when replaceAll is false).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to edit" },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            oldString: { type: "string" },
            newString: { type: "string" },
            replaceAll: { type: "boolean", default: false },
          },
          required: ["oldString", "newString"],
        },
      },
    },
    required: ["path", "edits"],
  },
  requiresPermission: true,

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, output: "", error: parsed.error.message };

    const { path, edits } = parsed.data;
    const abs = resolve(ctx.workingDirectory, path);

    if (!existsSync(abs)) return { success: false, output: "", error: `File not found: ${abs}` };

    try {
      let content = readFileSync(abs, "utf-8");
      const results: string[] = [];

      for (const edit of edits) {
        const { oldString, newString, replaceAll } = edit;

        if (!content.includes(oldString)) {
          return {
            success: false,
            output: "",
            error: `oldString not found in file:\n${oldString}`,
          };
        }

        if (!replaceAll) {
          const count = content.split(oldString).length - 1;
          if (count > 1) {
            return {
              success: false,
              output: "",
              error: `oldString found ${count} times — use replaceAll: true or provide a more specific string`,
            };
          }
        }

        const replaced = replaceAll
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);
        content = replaced;
        results.push(`Replaced "${oldString.slice(0, 50)}..."`);
      }

      writeFileSync(abs, content, "utf-8");
      return { success: true, output: results.join("\n") };
    } catch (err: unknown) {
      return { success: false, output: "", error: String(err) };
    }
  },
};
