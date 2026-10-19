import type { AgentStore } from "../ports.js";
import type { Notice } from "../pushes/notice-push.js";
import { noticeArea } from "./notice-record-of.js";
import { isMutableNoticeKind, isNoticeMuted, noticeSettingsOf } from "./notice-settings.js";

// A notice that sums up others is muted with them: the line of a copy order's held skips with the
// skips (decision 0260).
const mutedWith: ReadonlyMap<string, string> = new Map([["copyHeld", "skipped"]]);

/**
 * Whether the owner muted a notice (decision 0185): its kind may be muted, and the agent it names
 * muted it, or, for a notice that names no agent, every agent not archived did. A notice about an
 * agent the store does not hold goes.
 */
export async function isNoticeMutedFor(
  agents: Pick<AgentStore, "get" | "list">,
  notice: Notice,
  call: { readonly signal: AbortSignal },
): Promise<boolean> {
  const own = notice.key.slice(noticeArea.length);
  const kind = mutedWith.get(own) ?? own;
  if (!notice.key.startsWith(noticeArea) || !isMutableNoticeKind(kind)) {
    return false;
  }
  if (notice.agent !== undefined) {
    const found = await agents.get(notice.agent, call);
    return (
      found !== undefined && isNoticeMuted(kind, [noticeSettingsOf(found.agent.notifications)])
    );
  }
  const active = (await agents.list(call)).filter((agent) => agent.archivedAtMs === undefined);
  return isNoticeMuted(
    kind,
    active.map((agent) => noticeSettingsOf(agent.notifications)),
  );
}
