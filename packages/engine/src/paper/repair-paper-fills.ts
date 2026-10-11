import { type Clock, type Id, idSchema } from "@binference/core";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { paperFillOf } from "../intents/intent-history.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentStore, PositionStore } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import { isUsablePrice } from "../positions/value-execution.js";
import { paperTrade, recordFill } from "./paper-fills.js";

/** What the repair of paper fills reads intents and executions from, and records through. */
export interface PaperFillRepairOptions {
  readonly intents: IntentStore;
  readonly stored: StoredIntents;
  readonly store: PositionStore;
  readonly positions: Positions;
  readonly clock: Clock;
}

/** How far back the repair looks: 30 days of paper fills. */
export const paperRepairWindowMs: number = 30 * 86_400_000;

const pageSize = 200;
// The lowest intent id, so the first page starts at the window's first millisecond.
const firstId = idSchema("int").parse("int_00000000-0000-7000-8000-000000000000");

async function filledSince(
  options: PaperFillRepairOptions,
  fromMs: number,
  signal: AbortSignal,
): Promise<readonly IntentRecord[]> {
  const filled: IntentRecord[] = [];
  let after = { changedAtMs: fromMs - 1, id: firstId };
  for (;;) {
    const query = { states: ["paper_filled"] as const, isPaper: true, after, limit: pageSize };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last
    const page = await options.intents.list(query, { signal });
    filled.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < pageSize) {
      return filled;
    }
    after = { changedAtMs: last.changedAtMs, id: last.id };
  }
}

async function executedSince(
  options: PaperFillRepairOptions,
  fromMs: number,
  signal: AbortSignal,
): Promise<ReadonlySet<Id<"int">>> {
  const executed = new Set<Id<"int">>();
  let after = 0;
  for (;;) {
    const query = { isPaper: true, fromMs, after, limit: pageSize };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last
    const page = await options.store.executions(query, { signal });
    for (const execution of page) {
      executed.add(execution.intentId);
    }
    const last = page.at(-1);
    if (last === undefined || page.length < pageSize) {
      return executed;
    }
    after = last.id;
  }
}

// Records one fill's positions from the price its fill kept; false for a fill that kept none.
async function repairOne(
  options: PaperFillRepairOptions,
  record: IntentRecord,
  signal: AbortSignal,
): Promise<boolean> {
  const snapshot = await options.stored.snapshot(record.id, { signal });
  const fill = snapshot === undefined ? undefined : paperFillOf(snapshot.history);
  const soldPrice = fill?.soldPrice;
  const { quote } = record;
  if (
    fill === undefined ||
    soldPrice === undefined ||
    quote === undefined ||
    !isUsablePrice(soldPrice)
  ) {
    return false;
  }
  const gasAsset = quoteDocument.decode(quote).gas.asset;
  const trade = paperTrade(record, { ...fill, soldPrice }, gasAsset);
  await recordFill(options.positions, trade, { signal });
  return true;
}

/**
 * Records the positions of every paper fill of the last 30 days that has none, and answers how
 * many it recorded. The move to `paper_filled` and the positions are two writes, so a crash
 * between them leaves a filled intent with no positions; call this at startup, before any new
 * fill. Each fill is valued at the price it kept, never at today's. A fill recorded before fills
 * kept their price stays without positions.
 */
export async function repairPaperFills(
  options: PaperFillRepairOptions,
  call: { readonly signal: AbortSignal },
): Promise<number> {
  const { signal } = call;
  const fromMs = options.clock.now() - paperRepairWindowMs;
  const filled = await filledSince(options, fromMs, signal);
  const executed = await executedSince(options, fromMs, signal);
  let repaired = 0;
  for (const record of filled.filter((item) => !executed.has(item.id))) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one fill at a time: each moves positions
    if (await repairOne(options, record, signal)) {
      repaired += 1;
    }
  }
  return repaired;
}
