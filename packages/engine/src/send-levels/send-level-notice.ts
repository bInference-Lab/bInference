import type { SendLevelRecord, SendLevelState } from "../agents/send-level-record.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces a send level change (spec 4, section 4). */
export const sendLevelNoticeKey = "notice.sendLevel";

/** The message key of the notice that announces a cancelled looser level (spec 4, section 4). */
export const sendLevelCancelledKey = "notice.sendLevelCancelled";

// A looser level that waited and is gone without taking effect: cancelled or dropped by a move.
function cancelledNotice(before: SendLevelState, after: SendLevelRecord): readonly EnginePush[] {
  const { pending } = before;
  return pending === undefined || after.pending !== undefined
    ? []
    : [
        noticePush({
          key: sendLevelCancelledKey,
          agent: after.agentId,
          values: { to: String(pending.level), level: String(after.level) },
        }),
      ];
}

// A level that moved now, or a looser level that starts to wait, with the time it takes effect.
function movedNotice(before: SendLevelState, after: SendLevelRecord): readonly EnginePush[] {
  const { pending } = after;
  const from = String(before.level);
  if (pending !== undefined && pending.atMs !== before.pending?.atMs) {
    return [
      noticePush({
        key: sendLevelNoticeKey,
        agent: after.agentId,
        values: { from, to: String(pending.level), pending: "yes" },
        times: { when: pending.atMs },
      }),
    ];
  }
  return after.level === before.level
    ? []
    : [
        noticePush({
          key: sendLevelNoticeKey,
          agent: after.agentId,
          values: { from, to: String(after.level), pending: "no" },
        }),
      ];
}

/**
 * The notices that announce a send level move on every surface, none when it moved nothing: a
 * stricter level from now on, a looser one with the time it takes effect, so the owner can cancel
 * a loosening they did not ask for, and a looser level that waited and was cancelled or dropped.
 * `before` is the state in effect when the move was decided.
 */
export function sendLevelNotices(
  before: SendLevelState,
  after: SendLevelRecord,
): readonly EnginePush[] {
  return [...movedNotice(before, after), ...cancelledNotice(before, after)];
}
