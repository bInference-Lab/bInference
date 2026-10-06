import type { ConfigJournalEntry } from "../audit/config-change.js";
import type { ConfigJournal } from "../ports.js";
import { memoryCall } from "./memory-call.js";

/** Creates an empty in-memory {@link ConfigJournal} for tests. */
export function createMemoryConfigJournal(): ConfigJournal {
  const entries: ConfigJournalEntry[] = [];
  return {
    record: async (change, options) =>
      memoryCall(options, () => {
        const entry = { ...structuredClone(change), id: entries.length + 1 };
        entries.push(entry);
        return structuredClone(entry);
      }),
    list: async (page, options) =>
      memoryCall(options, () =>
        structuredClone(entries.filter((entry) => entry.id > page.after).slice(0, page.limit)),
      ),
  };
}
