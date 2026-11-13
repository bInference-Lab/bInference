import type { AgentRecord } from "../agents/agent-record.js";
import { ownFreezeOf } from "../agents/breaker-hold.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

// The message key of the notice that the breaker took hold of the install (decision 0441).
const breakerPulledKey = "notice.breakerPulled";

// The message key of the notice that the breaker let go of the install (decision 0441).
const breakerLiftedKey = "notice.breakerLifted";

/** The one notice of a pull: every agent frozen, funds in their wallets, a rescue still open. */
export function pulledNotice(): EnginePush {
  return noticePush({ key: breakerPulledKey, values: {} });
}

/**
 * The one notice of a lift, naming the agents not archived the owner's own freeze still holds,
 * in the order the store lists them, as a list each surface joins in the owner's language;
 * `frozen` says whether there are any.
 */
export function liftedNotice(agents: readonly AgentRecord[]): EnginePush {
  const held = agents.filter(
    (agent) => agent.archivedAtMs === undefined && ownFreezeOf(agent) !== undefined,
  );
  const frozen = held.length === 0 ? "none" : "some";
  const names = held.map((agent) => agent.name);
  return noticePush({ key: breakerLiftedKey, values: { frozen }, lists: { agents: names } });
}
