import type { LedgerDraft, LedgerEntry } from "../ledger/ledger-entry.js";
import { chainLedgerEntry } from "../ledger/ledger-hash.js";
import type { LedgerStore } from "../ports.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/** A ledger kept in memory, for tests. Other in-memory stores append through `appendNow`. */
export interface MemoryLedgerStore extends LedgerStore {
  /** Appends at once; another in-memory store calls it inside its own write. */
  appendNow(draft: LedgerDraft): LedgerEntry;
}

/** Creates an empty {@link MemoryLedgerStore}. It holds every entry until it is dropped. */
export function createMemoryLedgerStore(): MemoryLedgerStore {
  const entries: LedgerEntry[] = [];
  const appendNow = (draft: LedgerDraft): LedgerEntry => {
    if (entries.some((entry) => entry.id === draft.id)) {
      throw constraintFault(`the ledger already holds ${draft.id}`);
    }
    const entry = chainLedgerEntry(entries.at(-1), structuredClone(draft));
    entries.push(entry);
    return structuredClone(entry);
  };
  return {
    appendNow,
    append: async (draft, options) => memoryCall(options, () => appendNow(draft)),
    list: async (page, options) =>
      memoryCall(options, () =>
        structuredClone(entries.filter((entry) => entry.seq > page.after).slice(0, page.limit)),
      ),
    last: async (options) => memoryCall(options, () => structuredClone(entries.at(-1))),
  };
}
