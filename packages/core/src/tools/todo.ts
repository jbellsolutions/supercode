import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../types.js";

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  createdAt: string;
}

function getTodoPath(ctx: ToolContext): string {
  return join(ctx.workingDirectory, ".supercode", "todos.json");
}

function loadTodos(path: string): TodoItem[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as TodoItem[];
  } catch {
    return [];
  }
}

function saveTodos(path: string, todos: TodoItem[]): void {
  const dir = join(path, "..");
  writeFileSync(path, JSON.stringify(todos, null, 2), "utf-8");
}

const readSchema = z.object({});

export const TodoReadTool: Tool = {
  name: "TodoRead",
  description: "Read the current task list for this session.",
  inputSchema: { type: "object", properties: {} },
  requiresPermission: false,

  async execute(_input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const path = getTodoPath(ctx);
    const todos = loadTodos(path);
    if (todos.length === 0) return { success: true, output: "No todos yet." };

    const formatted = todos
      .map((t) => `[${t.status}] ${t.priority.toUpperCase()} — ${t.id}: ${t.content}`)
      .join("\n");
    return { success: true, output: formatted };
  },
};

const writeSchema = z.object({
  todos: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      status: z.enum(["pending", "in_progress", "done"]),
      priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
    })
  ),
});

export const TodoWriteTool: Tool = {
  name: "TodoWrite",
  description: "Update the task list. Replaces the full list with the provided todos.",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "done"] },
            priority: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["id", "content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  requiresPermission: false,

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = writeSchema.safeParse(input);
    if (!parsed.success) return { success: false, output: "", error: parsed.error.message };

    const path = getTodoPath(ctx);
    const todos: TodoItem[] = parsed.data.todos.map((t) => ({
      ...t,
      priority: t.priority ?? "medium",
      createdAt: new Date().toISOString(),
    }));

    try {
      // Ensure .supercode dir exists
      const { mkdirSync } = await import("fs");
      mkdirSync(join(ctx.workingDirectory, ".supercode"), { recursive: true });
      saveTodos(path, todos);
      return { success: true, output: `Saved ${todos.length} todos.` };
    } catch (err) {
      return { success: false, output: "", error: String(err) };
    }
  },
};
