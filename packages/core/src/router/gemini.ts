import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  Tool as GeminiTool,
  FunctionDeclaration,
  Part,
} from "@google/generative-ai";
import type { Message, Tool, StreamChunk } from "../types.js";
import type { TokenUsage } from "./cost-tracker.js";

export class GeminiAdapter {
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async *streamChat(
    model: string,
    messages: Message[],
    tools: Tool[]
  ): AsyncGenerator<StreamChunk & { usage?: TokenUsage }> {
    const geminiModel = this.client.getGenerativeModel({ model });

    const geminiTools: GeminiTool[] = tools.length
      ? [
          {
            functionDeclarations: tools.map(
              (t): FunctionDeclaration => ({
                name: t.name,
                description: t.description,
                parameters: t.inputSchema as any,
              })
            ),
          },
        ]
      : [];

    // Convert messages to Gemini format
    const systemMessage = messages.find((m) => m.role === "system");
    const history: Content[] = [];
    let currentUserParts: Part[] = [];

    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        history.push({ role: "user", parts: [{ text: msg.content }] });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          history.push({
            role: "model",
            parts: msg.toolCalls.map((tc) => ({
              functionCall: {
                name: tc.name,
                args: tc.input as Record<string, unknown>,
              },
            })),
          });
        } else {
          history.push({ role: "model", parts: [{ text: msg.content }] });
        }
      } else if (msg.role === "tool") {
        history.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: msg.toolCallId ?? "unknown",
                response: { result: msg.content },
              },
            },
          ],
        });
      }
    }

    const lastUserMsg = history.pop();
    const userText = lastUserMsg?.parts[0] &&
      "text" in lastUserMsg.parts[0]
      ? lastUserMsg.parts[0].text
      : "";

    const chat = geminiModel.startChat({
      history,
      tools: geminiTools,
      systemInstruction: systemMessage?.content,
    });

    const result = await chat.sendMessageStream(userText);

    let fullText = "";
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullText += text;
        yield { type: "text_delta", text };
      }

      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if ("functionCall" in part && part.functionCall) {
          const id = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          toolCalls.push({
            id,
            name: part.functionCall.name,
            input: part.functionCall.args,
          });
        }
      }
    }

    const finalResponse = await result.response;
    const usageMetadata = finalResponse.usageMetadata;

    if (fullText) {
      yield { type: "text_complete", text: fullText };
    }

    for (const tc of toolCalls) {
      yield { type: "tool_call", toolCall: tc };
    }

    if (usageMetadata) {
      yield {
        type: "usage",
        usage: {
          inputTokens: usageMetadata.promptTokenCount ?? 0,
          outputTokens: usageMetadata.candidatesTokenCount ?? 0,
        },
      };
    }
  }
}
