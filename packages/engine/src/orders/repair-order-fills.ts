import type { StoredIntents } from "../intents/create-stored-intents.js";
import { type AnnounceParts, announceRows, type CancelFillParts, cancelFill } from "./fill-ends.js";
import { unfinishedFills } from "./fill-faults.js";

/** What the startup's repair of order fills reads and writes through. */
export interface RepairOrderFillsParts extends AnnounceParts, CancelFillParts {
  readonly stored: StoredIntents;
}

const pageSize = 100;

// Cancels, unsigned, each fill a stop left unfinished: a paper one before it filled, a live one
// before its confirmation; answers how many.
async function cancelUnfinished(
  parts: RepairOrderFillsParts,
  signal: AbortSignal,
): Promise<number> {
  const paper = await unfinishedFills(parts.stored, { isPaper: true }, { signal });
  const live = await unfinishedFills(parts.stored, { isPaper: false }, { signal });
  const left = [...paper, ...live];
  return left.reduce<Promise<number>>(async (counted, snapshot) => {
    const count = await counted;
    const cancelled = await cancelFill(parts, { snapshot, cause: "engine_stopping", signal });
    return cancelled.record.state === "cancelled" ? count + 1 : count;
  }, Promise.resolve(0));
}

// Tells the owner every notice a stop kept from being announced, the oldest first; a page that
// marks none, its rows held for a report, ends the round.
async function announceLeft(parts: RepairOrderFillsParts, signal: AbortSignal): Promise<number> {
  const rows = await parts.orders.unannounced({ limit: pageSize }, { signal });
  const announced = rows.length === 0 ? 0 : await announceRows(parts, rows, signal);
  return announced === 0 ? 0 : announced + (await announceLeft(parts, signal));
}

/**
 * The startup's repair of order fills (decision 0197), before any price fires an order: every
 * paper fill a stop left unfinished, and every live fill a stop left before its confirmation, is
 * cancelled unsigned, so its value leaves the rolling cap and its order fills again at the next
 * trigger (decision 0210); then the owner is told every notice a stop kept from being announced.
 * A confirmed live fill is the executor's to recover. Answers how many intents and rows it
 * repaired.
 */
export async function repairOrderFills(
  parts: RepairOrderFillsParts,
  options: { readonly signal: AbortSignal },
): Promise<number> {
  const cancelled = await cancelUnfinished(parts, options.signal);
  return cancelled + (await announceLeft(parts, options.signal));
}
