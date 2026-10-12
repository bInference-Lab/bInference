import type { Clock } from "@binference/core";
import { limitsAt } from "../policy/limit-change.js";
import type { AgentStore } from "../ports.js";
import { type LimitsRecord, limitsValuesOf } from "./limits-record.js";

/**
 * A stored limits record as it is in effect at `nowMs`: looser limits whose 24 hours have passed
 * replace the limits they waited on, and ones still waiting stay pending (decision 0111).
 */
export function limitsRecordAt(record: LimitsRecord, nowMs: number): LimitsRecord {
  const { agentId, changedAtMs, version } = record;
  const { values, pending } = limitsAt(
    record.pending === undefined
      ? { values: limitsValuesOf(record) }
      : { values: limitsValuesOf(record), pending: record.pending },
    nowMs,
  );
  return {
    ...values,
    agentId,
    ...(pending === undefined ? {} : { pending }),
    changedAtMs,
    version,
  };
}

/**
 * The agent store as every engine part reads it: each agent's limits as they are in effect now,
 * so a loosening applies on time without a write. A write names the version of the stored row,
 * which this keeps.
 */
export function withLimitsInEffect(store: AgentStore, clock: Clock): AgentStore {
  return {
    create: async (draft, options) => store.create(draft, options),
    get: async (id, options) => {
      const settings = await store.get(id, options);
      return settings === undefined
        ? undefined
        : { ...settings, limits: limitsRecordAt(settings.limits, clock.now()) };
    },
    list: async (options) => store.list(options),
    setApprovalMode: async (change, options) => store.setApprovalMode(change, options),
    setLimits: async (change, options) => store.setLimits(change, options),
    setSendLevel: async (change, options) => store.setSendLevel(change, options),
    addAddress: async (entry, options) => store.addAddress(entry, options),
    removeAddress: async (removal, options) => store.removeAddress(removal, options),
    setMode: async (change, options) => store.setMode(change, options),
    setNotifications: async (change, options) => store.setNotifications(change, options),
    setModels: async (change, options) => store.setModels(change, options),
  };
}
