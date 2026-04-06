import type { Message, Tool, StreamChunk } from "../types.js";
import type { SupercodeConfig } from "../config/index.js";
import { GeminiAdapter } from "./gemini.js";
import { CodexAdapter } from "./codex.js";
import { OpenRouterAdapter } from "./openrouter.js";
import { CostTracker, type TokenUsage } from "./cost-tracker.js";

export type TaskType = "edit" | "read" | "plan" | "search" | "subagent" | "default";
export type Provider = "gemini" | "codex" | "openrouter";

export interface RouteOpts {
  preferredProvider?: Provider;
  taskType?: TaskType;
  maxCostCents?: number;
  contextTokens?: number;
  model?: string; // explicit model override
}

const ROUTING_TABLE: Record<TaskType, { primary: string; fallback: string }> = {
  read:     { primary: "gemini-2.5-pro",              fallback: "openrouter/deepseek-r1" },
  edit:     { primary: "codex-latest",                 fallback: "gemini-2.5-flash" },
  plan:     { primary: "openrouter/claude-3.5-haiku",  fallback: "gemini-2.5-flash" },
  search:   { primary: "gemini-2.5-flash",             fallback: "openrouter/mistral-nemo" },
  subagent: { primary: "gemini-2.5-flash",             fallback: "openrouter/mistral-nemo" },
  default:  { primary: "gemini-2.5-flash",             fallback: "gemini-2.5-flash" },
};

function providerFor(model: string): Provider {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("codex") || model.startsWith("gpt") || model.startsWith("o4") || model.startsWith("o3")) return "codex";
  return "openrouter";
}

export class ModelRouter {
  private gemini?: GeminiAdapter;
  private codex?: CodexAdapter;
  private openrouter?: OpenRouterAdapter;
  public readonly costTracker = new CostTracker();
  private currentModel: string;

  constructor(private config: SupercodeConfig) {
    this.currentModel = config.models.default;

    if (config.providers.gemini?.apiKey) {
      this.gemini = new GeminiAdapter(config.providers.gemini.apiKey);
    }
    if (config.providers.openai?.apiKey) {
      this.codex = new CodexAdapter(config.providers.openai.apiKey);
    }
    if (config.providers.openrouter?.apiKey) {
      this.openrouter = new OpenRouterAdapter(
        config.providers.openrouter.apiKey,
        config.providers.openrouter.baseUrl
      );
    }
  }

  resolveModel(opts: RouteOpts): string {
    if (opts.model) return opts.model;

    const taskType = opts.taskType ?? "default";
    const route = ROUTING_TABLE[taskType];

    // Check if preferred provider is available
    if (opts.preferredProvider) {
      const model = route.primary;
      if (providerFor(model) === opts.preferredProvider) return model;
    }

    // Check context length — use long-context model if needed
    if (opts.contextTokens && opts.contextTokens > 100_000) {
      return this.config.models.longContext;
    }

    const primary = route.primary;
    const primaryProvider = providerFor(primary);

    if (primaryProvider === "gemini" && this.gemini) return primary;
    if (primaryProvider === "codex" && this.codex) return primary;
    if (primaryProvider === "openrouter" && this.openrouter) return primary;

    // Fallback
    const fallback = route.fallback;
    const fallbackProvider = providerFor(fallback);

    if (fallbackProvider === "gemini" && this.gemini) return fallback;
    if (fallbackProvider === "codex" && this.codex) return fallback;
    if (fallbackProvider === "openrouter" && this.openrouter) return fallback;

    // Last resort — whichever provider is available
    if (this.gemini) return this.config.models.default;
    throw new Error("No model providers configured. Set GEMINI_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY.");
  }

  setCurrentModel(model: string): void {
    this.currentModel = model;
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  async *streamChat(
    messages: Message[],
    tools: Tool[],
    opts: RouteOpts = {}
  ): AsyncGenerator<StreamChunk> {
    const model = opts.model ?? this.currentModel ?? this.resolveModel(opts);
    const provider = providerFor(model);

    const adapter = provider === "gemini" ? this.gemini : provider === "codex" ? this.codex : this.openrouter;
    if (!adapter) {
      throw new Error(
        `Provider "${provider}" not configured. Check your API keys.`
      );
    }

    const gen = (adapter as any).streamChat(model, messages, tools) as AsyncGenerator<
      StreamChunk & { usage?: TokenUsage }
    >;

    for await (const chunk of gen) {
      if (chunk.type === "usage" && chunk.usage) {
        const cost = this.costTracker.track(model, chunk.usage);
        const maxCents = opts.maxCostCents ?? this.config.costs.maxPerSessionCents;
        if (this.costTracker.totalCents > maxCents) {
          throw new Error(
            `Session cost cap exceeded: ${this.costTracker.totalDollars} (limit: $${(maxCents / 100).toFixed(2)})`
          );
        }
      }
      yield chunk;
    }
  }
}
