import type { ToolCall, PermissionMode } from "../types.js";
import type { SupercodeConfig } from "../config/index.js";

export type ApprovalCallback = (call: ToolCall, description: string) => Promise<boolean>;

export class PermissionGate {
  private alwaysAllow: Set<string>;
  private alwaysDeny: Set<string>;

  constructor(
    private config: SupercodeConfig,
    private approvalCallback?: ApprovalCallback
  ) {
    this.alwaysAllow = new Set(config.permissions.alwaysAllow);
    this.alwaysDeny = new Set(config.permissions.alwaysDeny);
  }

  setApprovalCallback(cb: ApprovalCallback): void {
    this.approvalCallback = cb;
  }

  async check(call: ToolCall, mode: PermissionMode, toolRequiresPermission: boolean): Promise<boolean> {
    const name = call.name;

    // Step 1: Hard deny list
    if (this.alwaysDeny.has(name)) return false;

    // Step 2: Hard allow list
    if (this.alwaysAllow.has(name)) return true;

    // Step 3: Plan mode — never execute tools
    if (mode === "plan") return false;

    // Step 4: dontAsk mode — allow everything not in deny list
    if (mode === "dontAsk") return true;

    // Step 5: acceptEdits — auto-approve file edits
    if (mode === "acceptEdits" && ["Write", "Edit"].includes(name)) return true;

    // Step 6: Tool doesn't require permission
    if (!toolRequiresPermission) return true;

    // Step 7: Default mode — prompt user
    if (this.approvalCallback) {
      const desc = `Tool: ${name}\nInput: ${JSON.stringify(call.input, null, 2)}`;
      return await this.approvalCallback(call, desc);
    }

    // No callback set — deny by default (safe)
    return false;
  }
}
