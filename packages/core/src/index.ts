// Core exports
export { agentLoop, buildSystemPrompt } from "./agent/loop.js";
export { createSession, saveSession, loadSavedSession, listSessions } from "./agent/session.js";
export { createSubAgentTool } from "./agent/subagent.js";

export { ModelRouter } from "./router/index.js";
export { CostTracker } from "./router/cost-tracker.js";
export { GeminiAdapter } from "./router/gemini.js";
export { CodexAdapter } from "./router/codex.js";
export { OpenRouterAdapter } from "./router/openrouter.js";

export { ToolRegistry } from "./tools/registry.js";
export { ReadTool } from "./tools/read.js";
export { WriteTool } from "./tools/write.js";
export { EditTool } from "./tools/edit.js";
export { GlobTool } from "./tools/glob.js";
export { GrepTool } from "./tools/grep.js";
export { BashTool } from "./tools/bash.js";
export { WebFetchTool } from "./tools/web-fetch.js";
export { TodoReadTool, TodoWriteTool } from "./tools/todo.js";
export { SubAgentTool } from "./tools/sub-agent.js";

export { PermissionGate } from "./permissions/gate.js";
export { HookRunner } from "./permissions/hooks.js";

export { ContextLoader } from "./context/loader.js";
export { MemoryManager } from "./context/memory.js";

export { loadConfig } from "./config/index.js";

export type {
  Message,
  ToolCall,
  ToolResult,
  Tool,
  ToolContext,
  PermissionMode,
  StreamChunk,
  AgentEvent,
  Session,
} from "./types.js";

export type { SupercodeConfig } from "./config/index.js";
export type { RouteOpts, TaskType, Provider } from "./router/index.js";
