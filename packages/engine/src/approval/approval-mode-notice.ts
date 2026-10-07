import type { AgentRecord } from "../agents/agent-record.js";
import type { ApprovalModeRecord } from "../agents/approval-mode-record.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces an approval mode switch (spec 4, section 4). */
export const approvalModeNoticeKey = "notice.approvalMode";

/**
 * The notice that announces an agent's new approval mode on every surface: the agent's name, the
 * mode and the surface it was switched on.
 */
export function approvalModeNotice(agent: AgentRecord, mode: ApprovalModeRecord): EnginePush {
  return noticePush({
    key: approvalModeNoticeKey,
    agent: agent.id,
    values: { agent: agent.name, mode: mode.mode, surface: mode.changedBySurface },
  });
}
