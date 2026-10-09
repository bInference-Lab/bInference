import { err, type Id, ok, type Result } from "@binference/core";
import type { AddressEntryRecord, AddressEntryRemoval } from "../agents/address-entry-record.js";
import { byCreation } from "./memory-call.js";

/** The address books of the in-memory agent store: every entry ever added, removed ones too. */
export interface MemoryAddressBook {
  /** Adds an entry for an agent the store holds, as `AgentStore.addAddress` does. */
  add(entry: AddressEntryRecord): Result<AddressEntryRecord, "exists" | "saved">;
  /** Removes a live entry, as `AgentStore.removeAddress` does. */
  remove(removal: AddressEntryRemoval): Result<AddressEntryRecord, "not_found">;
  /** An agent's live entries, oldest first. */
  live(agent: Id<"agt">): readonly AddressEntryRecord[];
}

interface BookRow {
  readonly entry: AddressEntryRecord;
  readonly removedAtMs?: number;
}

/** Creates empty in-memory address books, which check what the SQLite store's keys check. */
export function createMemoryAddressBook(): MemoryAddressBook {
  const rows = new Map<Id<"adr">, BookRow>();
  const live = (agent: Id<"agt">): readonly AddressEntryRecord[] =>
    [...rows.values()]
      .filter((row) => row.removedAtMs === undefined && row.entry.agentId === agent)
      .map((row) => row.entry)
      .toSorted(byCreation);
  return {
    add(entry) {
      if (rows.has(entry.id)) {
        return err("exists");
      }
      if (live(entry.agentId).some((held) => held.account === entry.account)) {
        return err("saved");
      }
      rows.set(entry.id, { entry: structuredClone(entry) });
      return ok(structuredClone(entry));
    },
    remove(removal) {
      const row = rows.get(removal.id);
      if (row === undefined || row.removedAtMs !== undefined) {
        return err("not_found");
      }
      rows.set(removal.id, { ...row, removedAtMs: removal.atMs });
      return ok(structuredClone(row.entry));
    },
    live: (agent) => structuredClone(live(agent)),
  };
}
