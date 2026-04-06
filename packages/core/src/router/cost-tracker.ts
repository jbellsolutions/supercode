export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelPricing {
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}

// Approximate pricing (cents per 1M tokens)
const PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash": { inputCentsPerMillion: 15, outputCentsPerMillion: 60 },
  "gemini-2.5-pro": { inputCentsPerMillion: 125, outputCentsPerMillion: 1000 },
  "codex-latest": { inputCentsPerMillion: 300, outputCentsPerMillion: 1200 },
  "gpt-4o": { inputCentsPerMillion: 500, outputCentsPerMillion: 1500 },
  "o4-mini": { inputCentsPerMillion: 110, outputCentsPerMillion: 440 },
  "openrouter/deepseek-r1": { inputCentsPerMillion: 55, outputCentsPerMillion: 219 },
  "openrouter/mistral-nemo": { inputCentsPerMillion: 3.5, outputCentsPerMillion: 3.5 },
  "openrouter/claude-3.5-haiku": { inputCentsPerMillion: 80, outputCentsPerMillion: 400 },
};

const FREE_MODELS = new Set(["gemini-2.5-flash", "gemini-2.5-pro"]);

export class CostTracker {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCentsCost = 0;
  private usageLog: Array<{ model: string; usage: TokenUsage; cents: number; timestamp: Date }> = [];

  track(model: string, usage: TokenUsage): number {
    const pricing = PRICING[model] ?? { inputCentsPerMillion: 100, outputCentsPerMillion: 300 };
    const isFree = FREE_MODELS.has(model);
    const cents = isFree
      ? 0
      : (usage.inputTokens * pricing.inputCentsPerMillion) / 1_000_000 +
        (usage.outputTokens * pricing.outputCentsPerMillion) / 1_000_000;

    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    this.totalCentsCost += cents;
    this.usageLog.push({ model, usage, cents, timestamp: new Date() });

    return cents;
  }

  get totalCents(): number {
    return this.totalCentsCost;
  }

  get totalDollars(): string {
    return `$${(this.totalCentsCost / 100).toFixed(4)}`;
  }

  get totalTokens(): number {
    return this.totalInputTokens + this.totalOutputTokens;
  }

  summary(): string {
    return `Tokens: ${this.totalTokens.toLocaleString()} | Cost: ${this.totalDollars}`;
  }

  reset(): void {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCentsCost = 0;
    this.usageLog = [];
  }
}
