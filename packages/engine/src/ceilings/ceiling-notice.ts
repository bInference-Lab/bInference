import type { AgentRecord } from "../agents/agent-record.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces a ceiling change (decision 0132). */
export const ceilingChangeKey = "notice.ceilingChange";

/**
 * What a ceiling change moved: the venues a contract call may use, its native cap, both, or the
 * 24-hour caps every wallet shares.
 */
export type CeilingChangeKind = "venues" | "cap" | "both" | "dayCaps";

/**
 * The notice that announces on every surface that the owner key changed the ceiling of an agent's
 * wallets: the agent's name, the surface it came from and what moved. A change the owner did not
 * make means someone holds the owner key, so it tells them to freeze.
 */
export function ceilingChangeNotice(
  agent: AgentRecord,
  change: { readonly surface: string; readonly kind: CeilingChangeKind },
): EnginePush {
  return noticePush({
    key: ceilingChangeKey,
    agent: agent.id,
    values: { agent: agent.name, surface: change.surface, change: change.kind },
  });
}
