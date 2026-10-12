import type { Id } from "@binference/core";
import type { IntentState } from "@binference/protocol";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import {
  type AnnounceParts,
  announceRows,
  type CancelFillParts,
  cancelFill,
  fillOrderOf,
} from "./fill-ends.js";

/** What the startup's repair of order fills reads and writes through. */
export interface RepairOrderFillsParts extends AnnounceParts, CancelFillParts {
  readonly stored: StoredIntents;
}

// The states a paper fill passes through before it fills; a stop can leave it in any of them.
const unfinished: readonly IntentState[] = [
  "proposed",
  "checked",
  "quoted",
  "assessed",
  "simulated",
  "confirmed",
];

const pageSize = 100;

// Cancels, unsigned, each paper fill a stop left unfinished, page by page; answers how many.
async function cancelUnfinished(
  parts: RepairOrderFillsParts,
  signal: AbortSignal,
  after?: { readonly changedAtMs: number; readonly id: Id<"int"> },
): Promise<number> {
  const query = { states: unfinished, isPaper: true, limit: pageSize };
  const page = await parts.stored.list(after === undefined ? query : { ...query, after }, {
    signal,
  });
  const fills = page.filter(({ proposer }) => proposer === "engine");
  const cancelled = await fills.reduce<Promise<number>>(async (counted, record) => {
    const count = await counted;
    const snapshot = await parts.stored.snapshot(record.id, { signal });
    if (snapshot === undefined || fillOrderOf(snapshot) === undefined) {
      return count;
    }
    const ended = await cancelFill(parts, { snapshot, cause: "engine_stopping", signal });
    return ended.record.state === "cancelled" ? count + 1 : count;
  }, Promise.resolve(0));
  const last = page.at(-1);
  return page.length < pageSize || last === undefined
    ? cancelled
    : cancelled +
        (await cancelUnfinished(parts, signal, { changedAtMs: last.changedAtMs, id: last.id }));
}

// Tells the owner every notice a stop kept from being announced, the oldest first.
async function announceLeft(parts: RepairOrderFillsParts, signal: AbortSignal): Promise<number> {
  const rows = await parts.orders.unannounced({ limit: pageSize }, { signal });
  if (rows.length === 0) {
    return 0;
  }
  const announced = await announceRows(parts, rows, signal);
  return announced + (await announceLeft(parts, signal));
}

/**
 * The startup's repair of order fills (decision 0197), before any price fires an order: every
 * paper fill a stop left unfinished is cancelled unsigned, so its value leaves the rolling cap and
 * its order fills again at the next trigger; then the owner is told every notice a stop kept from
 * being announced. A live fill is left to the executor's recovery. Answers how many intents and
 * rows it repaired.
 */
export async function repairOrderFills(
  parts: RepairOrderFillsParts,
  options: { readonly signal: AbortSignal },
): Promise<number> {
  const cancelled = await cancelUnfinished(parts, options.signal);
  return cancelled + (await announceLeft(parts, options.signal));
}
