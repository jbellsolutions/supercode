import OpenAI from "openai";
import type { Message, Tool, StreamChunk } from "../types.js";
import type { TokenUsage } from "./cost-tracker.js";

export class CodexAdapter {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async *streamChat(
    model: string,
    messages: Message[],
    tools: Tool[]
  ): AsyncGenerator<StreamChunk & { usage?: TokenUsage }> {
    const openaiMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          tool_call_id: m.toolCallId ?? "unknown",
          content: m.content,
        };
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
            function: {
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            },
          }))
        : undefined;

    const stream = await this.client.chat.completions.create({
      model,
      messages: openaiMessages as any,
      tools: openaiTools,
      stream: true,
      stream_options: { include_usage: true },
    });

    let fullText = "";
    const toolCallAccumulator: Record<
      number,
      { id: string; name: string; arguments: string }
    > = {};
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        fullText += delta.content;
        yield { type: "text_delta", text: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallAccumulator[tc.index]) {
            toolCallAccumulator[tc.index] = { id: tc.id ?? "", name: "", arguments: "" };
          }
          if (tc.function?.name) toolCallAccumulator[tc.index].name += tc.function.name;
          if (tc.function?.arguments) toolCallAccumulator[tc.index].arguments += tc.function.arguments;
          if (tc.id) toolCallAccumulator[tc.index].id = tc.id;
        }
      }

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    if (fullText) yield { type: "text_complete", text: fullText };

    for (const tc of Object.values(toolCallAccumulator)) {
      let parsedInput: unknown = {};
      try {
        parsedInput = JSON.parse(tc.arguments);
      } catch {}
      yield {
        type: "tool_call",
        toolCall: { id: tc.id, name: tc.name, input: parsedInput },
      };
    }

    if (inputTokens || outputTokens) {
      yield { type: "usage", usage: { inputTokens, outputTokens } };
    }
  }
}
