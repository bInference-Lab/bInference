import { err, ok } from "@binference/core";
import type { InboxEntry } from "../ingress/inbox-entry.js";
import type { InboxStore } from "../ports.js";
import { memoryCall } from "./memory-call.js";

/** Creates an empty in-memory {@link InboxStore} for tests. */
export function createMemoryInboxStore(): InboxStore {
  let entries: readonly InboxEntry[] = [];
  return {
    admit: async (draft, options) =>
      memoryCall(options, () => {
        const stored = entries.find((entry) => entry.sourceKey === draft.sourceKey);
        if (stored !== undefined) {
          return { kind: "repeat", entry: structuredClone(stored) };
        }
        const entry = { ...structuredClone(draft), id: (entries.at(-1)?.id ?? 0) + 1 };
        entries = [...entries, entry];
        return { kind: "new", entry: structuredClone(entry) };
      }),
    markHandled: async (mark, options) =>
      memoryCall(options, () => {
        const entry = entries.find((stored) => stored.id === mark.id);
        if (entry === undefined) {
          return err("not_found");
        }
        if (entry.handledAtMs !== undefined) {
          return err("handled");
        }
        const handled = { ...entry, handledAtMs: mark.atMs };
        entries = entries.map((stored) => (stored.id === mark.id ? handled : stored));
        return ok(structuredClone(handled));
      }),
    unhandled: async (limit, options) =>
      memoryCall(options, () =>
        structuredClone(entries.filter((entry) => entry.handledAtMs === undefined).slice(0, limit)),
      ),
    prune: async (beforeMs, options) =>
      memoryCall(options, () => {
        const kept = entries.filter(
          (entry) => entry.handledAtMs === undefined || entry.handledAtMs >= beforeMs,
        );
        const pruned = entries.length - kept.length;
        entries = kept;
        return pruned;
      }),
  };
}
