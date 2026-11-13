import type { ModelCharge, ModelSpend, UsedTurn, UsedTurnQuery } from "../billing/model-charge.js";
import type { ModelUsageStore } from "../billing/ports.js";
import type { AgentStore } from "../ports.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/** What the in-memory usage store checks an attempt's agent against. */
export interface MemoryModelUsageStoreOptions {
  readonly agents: Pick<AgentStore, "get">;
}

// Spend in the order the SQLite store sums it: by agent, then by model, in code-unit order.
function byAgentThenModel(left: ModelSpend, right: ModelSpend): number {
  if (left.agent !== right.agent) {
    return left.agent < right.agent ? -1 : 1;
  }
  return left.model < right.model ? -1 : 1;
}

function added(sum: ModelSpend | undefined, charge: ModelCharge): ModelSpend {
  const { agent, model, inputTokens, outputTokens, cachedTokens, usdMicros } = charge;
  return {
    agent,
    model,
    inputTokens: (sum?.inputTokens ?? 0) + inputTokens,
    outputTokens: (sum?.outputTokens ?? 0) + outputTokens,
    cachedTokens: (sum?.cachedTokens ?? 0) + cachedTokens,
    usdMicros: (sum?.usdMicros ?? 0n) + usdMicros,
  };
}

// Each turn of the agent with a call at or after the query's time, once, at its last such call;
// in the order the SQLite store reads them: the earliest last call first, then by turn.
function turnsSince(attempts: Iterable<ModelCharge>, query: UsedTurnQuery): readonly UsedTurn[] {
  const last = new Map<string, UsedTurn>();
  for (const { agent, turn, atMs } of attempts) {
    const seen = last.get(turn);
    if (agent === query.agent && atMs >= query.fromMs && (seen?.lastAtMs ?? -1) < atMs) {
      last.set(turn, { turn, lastAtMs: atMs });
    }
  }
  return [...last.values()].toSorted(byLastCall);
}

// The earliest last call first, then by turn in code-unit order.
function byLastCall(left: UsedTurn, right: UsedTurn): number {
  if (left.lastAtMs !== right.lastAtMs) {
    return left.lastAtMs - right.lastAtMs;
  }
  return left.turn < right.turn ? -1 : 1;
}

/** Creates an in-memory {@link ModelUsageStore} with no usage, for tests. */
export function createMemoryModelUsageStore(
  options: MemoryModelUsageStoreOptions,
): ModelUsageStore {
  const attempts = new Map<string, ModelCharge>();
  const noticed = new Set<string>();
  return {
    async record(charge, call) {
      const isHeld = (await options.agents.get(charge.agent, call)) !== undefined;
      return memoryCall(call, () => {
        if (!isHeld) {
          throw constraintFault("usage of an agent the store does not hold");
        }
        if (attempts.has(charge.key)) {
          return "exists" as const;
        }
        attempts.set(charge.key, { ...charge });
        return "recorded" as const;
      });
    },
    spent: async (query, call) =>
      memoryCall(call, () => {
        const sums = new Map<string, ModelSpend>();
        for (const charge of attempts.values()) {
          const isInside = charge.atMs >= query.fromMs && charge.atMs < query.toMs;
          if (isInside && (query.agent === undefined || charge.agent === query.agent)) {
            const at = `${charge.agent} ${charge.model}`;
            sums.set(at, added(sums.get(at), charge));
          }
        }
        return [...sums.values()].toSorted(byAgentThenModel);
      }),
    claimBudgetNotice: async (claim, call) =>
      memoryCall(call, () => {
        const day = `${claim.agent} ${String(claim.dayAtMs)}`;
        const isFirst = !noticed.has(day);
        noticed.add(day);
        return isFirst;
      }),
    turnsSince: async (query, call) => memoryCall(call, () => turnsSince(attempts.values(), query)),
  };
}
