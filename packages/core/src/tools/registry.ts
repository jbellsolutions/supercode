import type { Tool } from "../types.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: Tool[]): void {
    for (const t of tools) this.register(t);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(call: { name: string; input: unknown }, ctx: import("../types.js").ToolContext): Promise<import("../types.js").ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { success: false, output: "", error: `Unknown tool: ${call.name}` };
    }
    try {
      return await tool.execute(call.input, ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: msg };
    }
  }
}
