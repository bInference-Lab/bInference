import type { Id } from "@binference/core";
import type { AgentRecord } from "./agent-record.js";

/**
 * The agent as every reader sees it while the breaker holds the install since `breakerAtMs`
 * (decision 0440): `frozenAtMs` is when it was first held, by the owner's freeze or the breaker,
 * `ownFrozenAtMs` the owner's freeze alone and `breakerAtMs` the breaker's. `agent.frozenAtMs` is
 * read as the owner's freeze, as the store keeps it. With no breaker the agent is as it is, so an
 * install the breaker never held sees no new field.
 */
export function withBreakerHold(agent: AgentRecord, breakerAtMs: number | undefined): AgentRecord {
  if (breakerAtMs === undefined) {
    return agent;
  }
  const { frozenAtMs: own, ownFrozenAtMs: _own, breakerAtMs: _breaker, ...rest } = agent;
  return {
    ...rest,
    frozenAtMs: own === undefined ? breakerAtMs : Math.min(own, breakerAtMs),
    ...(own === undefined ? {} : { ownFrozenAtMs: own }),
    breakerAtMs,
  };
}

/**
 * When the agent's owner froze it, apart from any hold of the breaker: what an unfreeze lifts, and
 * what the breaker's lift leaves (decision 0440).
 */
export function ownFreezeOf(agent: AgentRecord): number | undefined {
  return agent.breakerAtMs === undefined ? agent.frozenAtMs : agent.ownFrozenAtMs;
}

/**
 * What one write lifts as its orders move back to `active`: the owner's freeze of these agents,
 * which an unfreeze clears, and the breaker's hold, which its lift clears.
 */
export interface LiftedHolds {
  readonly agents: ReadonlySet<Id<"agt">>;
  readonly isBreakerLifted: boolean;
}

/** A write that lifts nothing. */
export const noLift: LiftedHolds = { agents: new Set(), isBreakerLifted: false };

/** Whether the agent is still held once a write's lifts land: by its owner, or by the breaker. */
export function staysHeld(agent: AgentRecord, lifted: LiftedHolds): boolean {
  const isOwnFrozen = ownFreezeOf(agent) !== undefined && !lifted.agents.has(agent.id);
  return isOwnFrozen || (agent.breakerAtMs !== undefined && !lifted.isBreakerLifted);
}
