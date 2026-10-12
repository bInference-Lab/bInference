import type { ModelCharge, ModelSpend } from "../billing/model-charge.js";
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
  };
}
