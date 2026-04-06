import { readFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { execa } from "execa";
import type { ToolCall, ToolResult } from "../types.js";

export type HookEvent = "pre-tool" | "post-tool" | "session-start" | "session-end";
export type HookAction = "allow" | "deny" | "transform" | "notify";

export interface HookDefinition {
  event: HookEvent;
  matcher: string; // glob-style tool name pattern
  action: HookAction;
  script?: string;
  condition?: string; // JS expression string evaluated at runtime
}

export interface HooksConfig {
  hooks: HookDefinition[];
}

function matchesMatcher(toolName: string, matcher: string): boolean {
  if (matcher === "*") return true;
  if (matcher.endsWith("*")) return toolName.startsWith(matcher.slice(0, -1));
  return toolName === matcher;
}

function evaluateCondition(condition: string, input: unknown): boolean {
  try {
    // Safe-ish evaluation using Function constructor
    const fn = new Function("input", `return !!(${condition})`);
    return fn(input);
  } catch {
    return false;
  }
}

export class HookRunner {
  private hooks: HookDefinition[] = [];

  load(hooksDir: string): void {
    const configPath = join(hooksDir, "config.yaml");
    if (!existsSync(configPath)) return;
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = yaml.load(raw) as HooksConfig;
      this.hooks = parsed?.hooks ?? [];
    } catch {
      this.hooks = [];
    }
  }

  addHooks(hooks: HookDefinition[]): void {
    this.hooks.push(...hooks);
  }

  async runPreTool(call: ToolCall): Promise<"allow" | "deny"> {
    for (const hook of this.hooks) {
      if (hook.event !== "pre-tool") continue;
      if (!matchesMatcher(call.name, hook.matcher)) continue;
      if (hook.condition && !evaluateCondition(hook.condition, call.input)) continue;

      if (hook.action === "deny") return "deny";

      if (hook.action === "notify" && hook.script) {
        try {
          await execa(hook.script, [], {
            env: {
              ...process.env,
              SUPERCODE_TOOL: call.name,
              SUPERCODE_INPUT: JSON.stringify(call.input),
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }
    return "allow";
  }

  async runPostTool(call: ToolCall, result: ToolResult): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.event !== "post-tool") continue;
      if (!matchesMatcher(call.name, hook.matcher)) continue;

      if (hook.action === "notify" && hook.script) {
        try {
          await execa(hook.script, [], {
            env: {
              ...process.env,
              SUPERCODE_TOOL: call.name,
              SUPERCODE_INPUT: JSON.stringify(call.input),
              SUPERCODE_OUTPUT: result.output,
              SUPERCODE_SUCCESS: String(result.success),
            },
          });
        } catch {}
      }
    }
  }

  async runSessionEvent(event: "session-start" | "session-end", sessionId: string): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.event !== event) continue;
      if (hook.script) {
        try {
          await execa(hook.script, [], {
            env: { ...process.env, SUPERCODE_SESSION_ID: sessionId },
          });
        } catch {}
      }
    }
  }
}
