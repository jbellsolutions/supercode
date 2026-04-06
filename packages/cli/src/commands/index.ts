import type { Session } from "@supercode/core";
import type { ModelRouter } from "@supercode/core";
import type { TerminalRenderer } from "../display/renderer.js";

export interface CommandContext {
  session: Session;
  router: ModelRouter;
  renderer: TerminalRenderer;
}

export interface CommandResult {
  type: "exit" | "clear" | "noop" | "model_changed";
  message?: string;
}

const COMMANDS: Record<string, (args: string[], ctx: CommandContext) => Promise<CommandResult>> = {
  help: async (_args, ctx) => {
    ctx.renderer.printInfo(`
Available commands:
  /help              Show this help
  /model <name>      Switch the active model mid-session
  /cost              Show current session cost
  /memory            Show loaded SUPERCODE.md context
  /tools             List registered tools
  /mode <mode>       Change permission mode (default|acceptEdits|plan|dontAsk)
  /clear             Clear conversation history
  /exit              End session
`);
    return { type: "noop" };
  },

  model: async (args, ctx) => {
    const model = args[0];
    if (!model) {
      ctx.renderer.printInfo(`Current model: ${ctx.router.getCurrentModel()}`);
      return { type: "noop" };
    }
    ctx.router.setCurrentModel(model);
    ctx.session.model = model;
    ctx.renderer.printSuccess(`Switched to model: ${model}`);
    return { type: "model_changed", message: model };
  },

  cost: async (_args, ctx) => {
    ctx.renderer.printCost(ctx.router.costTracker.summary());
    return { type: "noop" };
  },

  tools: async (_args, ctx) => {
    const tools = ctx.session.tools.map((t) => `  ${t.name} — ${t.description}`).join("\n");
    ctx.renderer.printInfo(`Registered tools:\n${tools}`);
    return { type: "noop" };
  },

  mode: async (args, ctx) => {
    const mode = args[0] as Session["mode"];
    const valid = ["default", "acceptEdits", "plan", "dontAsk"];
    if (!mode || !valid.includes(mode)) {
      ctx.renderer.printError(`Invalid mode. Choose: ${valid.join(", ")}`);
      return { type: "noop" };
    }
    ctx.session.mode = mode;
    ctx.renderer.printSuccess(`Mode set to: ${mode}`);
    return { type: "noop" };
  },

  memory: async (_args, ctx) => {
    ctx.renderer.printInfo(ctx.session.systemPrompt);
    return { type: "noop" };
  },

  clear: async (_args, ctx) => {
    ctx.session.messages = [];
    ctx.renderer.printSuccess("Conversation history cleared.");
    return { type: "clear" };
  },

  exit: async () => {
    return { type: "exit" };
  },
};

export async function handleCommand(input: string, ctx: CommandContext): Promise<CommandResult | null> {
  if (!input.startsWith("/")) return null;

  const [rawCmd, ...args] = input.slice(1).trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();

  const handler = COMMANDS[cmd];
  if (!handler) {
    ctx.renderer.printError(`Unknown command: /${cmd}. Type /help for available commands.`);
    return { type: "noop" };
  }

  return handler(args, ctx);
}
