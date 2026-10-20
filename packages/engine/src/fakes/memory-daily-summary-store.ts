import { err, ok } from "@binference/core";
import type { AgentStore } from "../ports.js";
import type { DailySummaryRecord } from "../summaries/daily-summary-record.js";
import type { DailySummaryStore } from "../summaries/ports.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/** What the in-memory daily summary store checks a summary's agent against. */
export interface MemoryDailySummaryStoreOptions {
  readonly agents: Pick<AgentStore, "get">;
}

/** Creates an in-memory {@link DailySummaryStore} with no summary, for tests. */
export function createMemoryDailySummaryStore(
  options: MemoryDailySummaryStoreOptions,
): DailySummaryStore {
  const latest = new Map<string, DailySummaryRecord>();
  return {
    async claim(record, call) {
      const isHeld = (await options.agents.get(record.agentId, call)) !== undefined;
      return memoryCall(call, () => {
        if (!isHeld) {
          throw constraintFault("a summary of an agent the store does not hold");
        }
        const before = latest.get(record.agentId);
        if (before !== undefined && before.date >= record.date) {
          return err("claimed" as const);
        }
        latest.set(record.agentId, structuredClone(record));
        return ok(structuredClone(record));
      });
    },
    latest: async (agent, call) => memoryCall(call, () => structuredClone(latest.get(agent))),
  };
}
