import type { JsonValue } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import type { LedgerEntry } from "./ledger-entry.js";

/** One ledger entry as `ledger/list` and the `ledger/appended` push show it, with its hashes. */
export type LedgerEntryView = ResultOf<"ledger/list">["items"][number];

interface JsonObject {
  readonly [key: string]: JsonValue;
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The view of one ledger entry. The view's data is an object: data of another shape is kept under
 * `value`, and an entry about the whole install shows an empty subject.
 */
export function ledgerEntryViewOf(entry: LedgerEntry): LedgerEntryView {
  return {
    seq: entry.seq,
    entry: entry.id,
    at: entry.atMs,
    ...(entry.agentId === undefined ? {} : { agent: entry.agentId }),
    kind: entry.kind,
    subject: entry.subject ?? "",
    data: isObject(entry.data) ? entry.data : { value: entry.data },
    prevHash: entry.prevHash,
    hash: entry.hash,
  };
}
