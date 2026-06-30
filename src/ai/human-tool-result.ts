import type { DiscriminatedApprovalResult } from "../schemas/index.js";
import type { HumanToolResult } from "./types.js";

const APPROVE_IDS = new Set(["approve", "approved"]);
const DECLINE_IDS = new Set(["decline", "reject", "deny", "denied"]);

export function toHumanToolResult(
  result: DiscriminatedApprovalResult<readonly { id: string }[]>
): HumanToolResult {
  const payload: HumanToolResult = {
    taskId: result.taskId,
    actionId: result.actionId,
    data: result.data,
    handledBy: result.handledBy,
    handledAt: result.handledAt.toISOString(),
  };

  if (APPROVE_IDS.has(result.actionId)) {
    payload.approved = true;
  } else if (DECLINE_IDS.has(result.actionId)) {
    payload.approved = false;
  }

  return payload;
}
