import type { SendLevelRecord, SendLevelState } from "../agents/send-level-record.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces a send level change (spec 4, section 4). */
export const sendLevelNoticeKey = "notice.sendLevel";

/**
 * The notice that announces a send level change on every surface, or `undefined` when the move
 * changed no level: a stricter level from now on, or a looser one and the time it takes effect,
 * so the owner can cancel a loosening they did not ask for. `before` is the state in effect when
 * the move was decided.
 */
export function sendLevelNotice(
  before: SendLevelState,
  after: SendLevelRecord,
): EnginePush | undefined {
  const { pending } = after;
  const from = String(before.level);
  if (pending !== undefined && pending.atMs !== before.pending?.atMs) {
    return noticePush({
      key: sendLevelNoticeKey,
      agent: after.agentId,
      values: { from, to: String(pending.level), pending: "yes" },
      times: { when: pending.atMs },
    });
  }
  return after.level === before.level
    ? undefined
    : noticePush({
        key: sendLevelNoticeKey,
        agent: after.agentId,
        values: { from, to: String(after.level), pending: "no" },
      });
}
