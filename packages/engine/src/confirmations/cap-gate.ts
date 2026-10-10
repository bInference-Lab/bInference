import type { Clock, Id } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { recentOutflowsOf } from "../money-path/recent-outflows.js";
import type { IntentStore } from "../ports.js";

/**
 * The rolling 24-hour cap at the moment of a confirmation (decision 0136). The confirmations of
 * one agent, by the owner's tap or the auto mode, run one at a time through it, each reading the
 * agent's confirmed outflows as the ones before left them, so no two confirmations can land
 * together past a cap they exceed together.
 */
export interface CapGate {
  /** Runs `confirm` once every earlier confirmation of the agent has ended. */
  serially<T>(agent: Id<"agt">, confirm: () => Promise<T>): Promise<T>;
  /**
   * What the agent's outflows of the last 24 hours add up to now in the intent's mode, the
   * intent's own left out.
   */
  spent(snapshot: IntentSnapshot, options: { readonly signal: AbortSignal }): Promise<bigint>;
  /**
   * Whether confirming the intent now keeps the agent within its rolling cap: its stored value
   * and what the agent spent come to at most the cap in effect. An intent without a value, such
   * as a rescue, always fits.
   */
  fits(snapshot: IntentSnapshot, options: { readonly signal: AbortSignal }): Promise<boolean>;
}

/** What the gate reads the confirmed outflows and the time from. */
export interface CapGateOptions {
  readonly intents: Pick<IntentStore, "confirmedSince">;
  readonly clock: Clock;
}

/**
 * Creates the {@link CapGate}. It keeps one queue per agent with a confirmation under way, and
 * drops it once the last one ends, so it holds no more entries than agents confirming at once.
 */
export function createCapGate(options: CapGateOptions): CapGate {
  const queues = new Map<Id<"agt">, Promise<void>>();
  const spent = async (snapshot: IntentSnapshot, call: { readonly signal: AbortSignal }) => {
    const { record } = snapshot;
    const query = {
      agentId: record.agentId,
      isPaper: record.isPaper,
      nowMs: options.clock.now(),
      exclude: record.id,
    };
    const outflows = await recentOutflowsOf(options.intents, query, call);
    return outflows.reduce((total, outflow) => total + outflow.valueUsdMicros, 0n);
  };
  return {
    async serially(agent, confirm) {
      const before = queues.get(agent) ?? Promise.resolve();
      const run = before.then(confirm, confirm);
      const tail = run.then(
        () => undefined,
        () => undefined,
      );
      queues.set(agent, tail);
      try {
        return await run;
      } finally {
        if (queues.get(agent) === tail) {
          queues.delete(agent);
        }
      }
    },
    spent,
    async fits(snapshot, call) {
      const value = snapshot.record.valueUsdMicros;
      if (value === undefined) {
        return true;
      }
      const cap = snapshot.settings.limits.rollingDayUsdMicros;
      return (await spent(snapshot, call)) + value <= cap;
    },
  };
}
