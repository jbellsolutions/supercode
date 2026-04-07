import OpenAI from "openai";
import type { Message, Tool, StreamChunk } from "../types.js";
import type { TokenUsage } from "./cost-tracker.js";

/**
 * OpenRouter uses an OpenAI-compatible API — we just override the baseURL.
 * Model names are prefixed with the provider, e.g. "openrouter/deepseek-r1"
 * maps to "deepseek/deepseek-r1" on OpenRouter.
 */
// Legacy short-name aliases
const MODEL_MAP: Record<string, string> = {
  "openrouter/deepseek-r1":     "deepseek/deepseek-r1",
  "openrouter/mistral-nemo":    "mistralai/mistral-nemo",
  "openrouter/claude-3.5-haiku": "anthropic/claude-3-5-haiku",
};

function resolveModel(model: string): string {
  // Explicit alias map
  if (MODEL_MAP[model]) return MODEL_MAP[model];
  // Strip "openrouter/" prefix — everything after it IS the real model id
  // e.g. "openrouter/deepseek/deepseek-r1" → "deepseek/deepseek-r1"
  if (model.startsWith("openrouter/")) return model.slice("openrouter/".length);
  return model;
}

export class OpenRouterAdapter {
  private client: OpenAI;

  constructor(apiKey: string, baseUrl = "https://openrouter.ai/api/v1") {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/jbellsolutions/supercode",
        "X-Title": "SuperCode",
      },
    });
  }

  async *streamChat(
    model: string,
    messages: Message[],
    tools: Tool[]
  ): AsyncGenerator<StreamChunk & { usage?: TokenUsage }> {
    const resolvedModel = resolveModel(model);

    const openaiMessages = messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool" as const, tool_call_id: m.toolCallId ?? "unknown", content: m.content };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        };
      }
      return { role: m.role as "system" | "user" | "assistant", content: m.content };
    });

    const openaiTools =
      tools.length > 0
        ? tools.map((t) => ({
            type: "function" as const,
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          }))
        : undefined;

    const stream = await this.client.chat.completions.create({
      model: resolvedModel,
      messages: openaiMessages as any,
      tools: openaiTools,
      stream: true,
    });

    let fullText = "";
    const toolCallAccumulator: Record<number, { id: string; name: string; arguments: string }> = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        fullText += delta.content;
        yield { type: "text_delta", text: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallAccumulator[tc.index]) toolCallAccumulator[tc.index] = { id: tc.id ?? "", name: "", arguments: "" };
          if (tc.function?.name) toolCallAccumulator[tc.index].name += tc.function.name;
          if (tc.function?.arguments) toolCallAccumulator[tc.index].arguments += tc.function.arguments;
          if (tc.id) toolCallAccumulator[tc.index].id = tc.id;
        }
      }
      if ((chunk as any).usage) {
        const u = (chunk as any).usage;
        yield { type: "usage", usage: { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 } };
      }
    }

    if (fullText) yield { type: "text_complete", text: fullText };
    for (const tc of Object.values(toolCallAccumulator)) {
      let parsedInput: unknown = {};
      try { parsedInput = JSON.parse(tc.arguments); } catch {}
      yield { type: "tool_call", toolCall: { id: tc.id, name: tc.name, input: parsedInput } };
    }
  }
}
