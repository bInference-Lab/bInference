import type { ChainRegistry } from "@binference/chain";
import type { Clock, Id, JsonValue } from "@binference/core";
import type { DcaOrderRequest } from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { knownAssetInfos } from "../money-path/asset-infos.js";
import type { IntentStore } from "../ports.js";
import { epochMsSchema } from "../records/record-fields.js";
import { nextRunOf } from "../schedules/schedule-times.js";
import type { OrderFills } from "./fill-orders.js";
import { moveOrder } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

/**
 * How late a DCA order's period may still buy: the queue runs every 10 seconds while the engine
 * is unlocked, and a buy may wait in its agent's line of fills. A later period was missed.
 */
const dcaGraceMs = 60_000;

/** What a DCA order keeps in its trigger state: when its next period comes (decision 0246). */
interface DcaPeriod {
  readonly nextAtMs: number;
}

const dcaPeriodSchema: z.ZodType<DcaPeriod> = z.strictObject({ nextAtMs: epochMsSchema });
const dcaPeriodDocument: DocumentCodec<DcaPeriod> = documentCodec("DCA period", dcaPeriodSchema);

/** The DCA orders' runner, which the schedule queue's timer runs: each call runs the due periods. */
export interface DcaOrders {
  run(options: { readonly signal: AbortSignal }): Promise<void>;
}

/** What the runner reads, moves and fills through. */
export interface DcaOrdersParts {
  readonly orders: OrderStore;
  readonly fills: OrderFills;
  /** Where a token's decimals come from: the registry, else what its order's card stored. */
  readonly chains: ChainRegistry;
  readonly intents: Pick<IntentStore, "storedAssets">;
  readonly clock: Clock;
}

const pageSize = 1_000;

// The kept period, or none when the order has not kept one yet or what it kept does not read.
function periodOf(kept: JsonValue | undefined): number | undefined {
  const parsed = dcaPeriodSchema.safeParse(kept);
  return parsed.success ? parsed.data.nextAtMs : undefined;
}

// The first run of the order's period after `afterMs`, on its own zone's wall clock.
function runAfter(request: DcaOrderRequest, afterMs: number): number | undefined {
  const { cron, timezone = "UTC" } = request.trigger;
  const next = nextRunOf({ cron, timezone }, afterMs, timezone);
  return next.ok ? next.value?.nextAtMs : undefined;
}

// Keeps the order's next period under the version it read; answers whether the write landed.
async function keep(
  parts: DcaOrdersParts,
  order: OrderRecord,
  call: { readonly nextAtMs: number; readonly signal: AbortSignal },
): Promise<boolean> {
  const triggerState = dcaPeriodDocument.encode({ nextAtMs: call.nextAtMs });
  const move = moveOrder(order, { type: "trigger_kept", triggerState }, parts.clock.now());
  const written = move.ok ? await parts.orders.move([move.value], { signal: call.signal }) : null;
  return written?.ok === true;
}

async function decimalsOf(
  parts: DcaOrdersParts,
  order: OrderRecord,
  signal: AbortSignal,
): Promise<number | undefined> {
  const { token } = order.request;
  const infos = await knownAssetInfos(parts, [token], { signal });
  return infos[token]?.decimals;
}

// The period that came due by `nowMs`, if one did. A new order's first period is the first run
// after it became active, which is kept as soon as it is worked out.
async function duePeriod(
  parts: DcaOrdersParts,
  order: OrderRecord & { readonly request: DcaOrderRequest },
  call: { readonly nowMs: number; readonly signal: AbortSignal },
): Promise<number | undefined> {
  const kept = periodOf(order.triggerState);
  const dueAtMs = kept ?? runAfter(order.request, order.changedAtMs);
  if (dueAtMs !== undefined && kept === undefined && dueAtMs > call.nowMs) {
    await keep(parts, order, { nextAtMs: dueAtMs, signal: call.signal });
  }
  return dueAtMs !== undefined && dueAtMs <= call.nowMs ? dueAtMs : undefined;
}

// A period on time buys once; a token whose decimals nothing knows skips as a failed fill.
async function buy(parts: DcaOrdersParts, order: OrderRecord, signal: AbortSignal) {
  const decimals = await decimalsOf(parts, order, signal);
  await (decimals === undefined
    ? parts.fills.skip({ order: order.id, reason: "fill_failed" }, { signal })
    : parts.fills.run({ order: order.id, price: { decimals } }, { signal }));
}

// One order's due period: the next one is kept first, so a stop never buys a period twice; then
// a period still on time buys, and a later one is recorded as missed, never bought.
async function runOne(parts: DcaOrdersParts, order: OrderRecord, signal: AbortSignal) {
  const { request } = order;
  if (request.kind !== "dca") {
    return;
  }
  const nowMs = parts.clock.now();
  const dueAtMs = await duePeriod(parts, { ...order, request }, { nowMs, signal });
  const following = dueAtMs === undefined ? undefined : runAfter(request, nowMs);
  if (dueAtMs === undefined || following === undefined) {
    return;
  }
  if (!(await keep(parts, order, { nextAtMs: following, signal }))) {
    return;
  }
  await (nowMs - dueAtMs > dcaGraceMs
    ? parts.fills.skip({ order: order.id, reason: "missed" }, { signal })
    : buy(parts, order, signal));
}

// Every active DCA order, page after page until a page comes back empty.
async function activeDca(
  parts: DcaOrdersParts,
  signal: AbortSignal,
  after?: { readonly createdAtMs: number; readonly id: Id<"ord"> },
): Promise<readonly OrderRecord[]> {
  const base = { states: ["active" as const], limit: pageSize };
  const page = await parts.orders.list(after === undefined ? base : { ...base, after }, { signal });
  const last = page.at(-1);
  const dca = page.filter(({ kind }) => kind === "dca");
  if (last === undefined) {
    return dca;
  }
  const cursor = { createdAtMs: last.createdAtMs, id: last.id };
  return [...dca, ...(await activeDca(parts, signal, cursor))];
}

/**
 * Creates the DCA orders' runner (decision 0246). Each run takes the active DCA orders: a period
 * that came within the last minute buys once through the order fills, with no card, in its
 * order's mode and bounds; a period that came while the order could not buy, the engine off or
 * locked or its agent frozen, is recorded as a `missed` skip and never bought. A paused order
 * runs no period; the order ends after its count of buys or at its expiry, as every order does.
 */
export function createDcaOrders(parts: DcaOrdersParts): DcaOrders {
  return {
    async run({ signal }) {
      const orders = await activeDca(parts, signal);
      for (const order of orders) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one order at a time, in order
        await runOne(parts, order, signal);
      }
    },
  };
}
