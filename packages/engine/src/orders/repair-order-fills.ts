import type { StoredIntents } from "../intents/create-stored-intents.js";
import { type AnnounceParts, announceRows, type CancelFillParts, cancelFill } from "./fill-ends.js";
import { unfinishedFills } from "./fill-faults.js";

/** What the startup's repair of order fills reads and writes through. */
export interface RepairOrderFillsParts extends AnnounceParts, CancelFillParts {
  readonly stored: StoredIntents;
}

const pageSize = 100;

// Cancels, unsigned, each paper fill a stop left unfinished; answers how many.
async function cancelUnfinished(
  parts: RepairOrderFillsParts,
  signal: AbortSignal,
): Promise<number> {
  const left = await unfinishedFills(parts.stored, { isPaper: true }, { signal });
  return left.reduce<Promise<number>>(async (counted, snapshot) => {
    const count = await counted;
    const cancelled = await cancelFill(parts, { snapshot, cause: "engine_stopping", signal });
    return cancelled.record.state === "cancelled" ? count + 1 : count;
  }, Promise.resolve(0));
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
