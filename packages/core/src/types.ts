export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string; // for tool result messages
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresPermission: boolean;
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  workingDirectory: string;
  sessionId: string;
  mode: PermissionMode;
}

export type PermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk";

// Stream chunk types
export type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "text_complete"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: { inputTokens: number; outputTokens: number } }
  | { type: "error"; error: string };

export interface AgentEvent {
  type: "assistant_text" | "tool_call" | "tool_result" | "cost_update" | "error" | "done";
  text?: string;
  toolCall?: ToolCall;
  toolResult?: { call: ToolCall; result: ToolResult };
  costSummary?: string;
  error?: string;
}

export interface Session {
  id: string;
  workingDirectory: string;
  mode: PermissionMode;
  maxTurns: number;
  messages: Message[];
  tools: Tool[];
  systemPrompt: string;
  model?: string;
  startTime: Date;
}
