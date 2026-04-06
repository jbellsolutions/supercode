import type { Session, Message, AgentEvent, ToolCall } from "../types.js";
import type { ModelRouter } from "../router/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { PermissionGate } from "../permissions/gate.js";
import type { HookRunner } from "../permissions/hooks.js";

export interface AgentRuntime {
  router: ModelRouter;
  registry: ToolRegistry;
  gate: PermissionGate;
  hooks: HookRunner;
}

export function buildSystemPrompt(opts: { workingDirectory: string; projectContext?: string; memory?: string }): string {
  const parts = [
    `You are SuperCode, an expert AI coding agent.`,
    `Working directory: ${opts.workingDirectory}`,
    `You have access to tools for reading, writing, and editing files, running shell commands, searching the web, and spawning sub-agents.`,
    `Always think step by step. Use tools to gather information before making changes.`,
    `When editing files, prefer targeted edits over full rewrites unless the file is new.`,
  ];

  if (opts.projectContext) {
    parts.push(`\n## Project Context\n${opts.projectContext}`);
  }

  if (opts.memory) {
    parts.push(`\n${opts.memory}`);
  }

  return parts.join("\n");
}

function toolDeniedResult(call: ToolCall): Message {
  return {
    role: "tool",
    toolCallId: call.id,
    content: `[Permission denied for tool: ${call.name}]`,
  };
}

function toolDeniedByHookResult(call: ToolCall): Message {
  return {
    role: "tool",
    toolCallId: call.id,
    content: `[Tool ${call.name} was blocked by a pre-execution hook]`,
  };
}

export async function* agentLoop(
  session: Session,
  runtime: AgentRuntime
): AsyncGenerator<AgentEvent> {
  let turns = 0;

  while (turns < session.maxTurns) {
    turns++;

    // Build the message list including the system prompt
    const messages: Message[] = [
      { role: "system", content: session.systemPrompt },
      ...session.messages,
    ];

    // Stream model response
    let assistantText = "";
    const pendingToolCalls: ToolCall[] = [];

    try {
      for await (const chunk of runtime.router.streamChat(messages, session.tools, {
        model: session.model,
      })) {
        if (chunk.type === "text_delta") {
          assistantText += chunk.text;
          yield { type: "assistant_text", text: chunk.text };
        } else if (chunk.type === "tool_call") {
          pendingToolCalls.push(chunk.toolCall);
        } else if (chunk.type === "usage") {
          yield {
            type: "cost_update",
            costSummary: runtime.router.costTracker.summary(),
          };
        } else if (chunk.type === "error") {
          yield { type: "error", error: chunk.error };
          return;
        }
      }
    } catch (err: unknown) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }

    // Add assistant message to history
    const assistantMsg: Message = {
      role: "assistant",
      content: assistantText,
      toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
    };
    session.messages.push(assistantMsg);

    // If no tool calls — we're done
    if (pendingToolCalls.length === 0) {
      yield { type: "done" };
      return;
    }

    // Execute tool calls
    for (const call of pendingToolCalls) {
      yield { type: "tool_call", toolCall: call };

      // Run pre-tool hooks
      const hookDecision = await runtime.hooks.runPreTool(call);
      if (hookDecision === "deny") {
        session.messages.push(toolDeniedByHookResult(call));
        continue;
      }

      // Check permissions
      const tool = runtime.registry.get(call.name);
      const permitted = await runtime.gate.check(
        call,
        session.mode,
        tool?.requiresPermission ?? true
      );

      if (!permitted) {
        session.messages.push(toolDeniedResult(call));
        continue;
      }

      // Execute the tool
      const toolCtx = {
        workingDirectory: session.workingDirectory,
        sessionId: session.id,
        mode: session.mode,
      };

      const result = await runtime.registry.execute(call, toolCtx);

      // Run post-tool hooks
      await runtime.hooks.runPostTool(call, result);

      yield { type: "tool_result", toolCall: call, toolResult: result };

      // Add result to message history
      session.messages.push({
        role: "tool",
        toolCallId: call.id,
        content: result.success
          ? result.output
          : `Error: ${result.error ?? "Unknown error"}\n${result.output}`,
      });
    }
  }

  yield {
    type: "error",
    error: `Max turns (${session.maxTurns}) reached without completing the task.`,
  };
}
