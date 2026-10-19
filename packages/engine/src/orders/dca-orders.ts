import type { ChainRegistry } from "@binference/chain";
import { BinferenceError, type Clock, type Id, ok } from "@binference/core";
import type { DcaOrderRequest } from "@binference/protocol";
import { knownAssetInfos } from "../money-path/asset-infos.js";
import type { IntentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { dcaPeriodDocument, isPeriodLate, periodOf, runAfter } from "./dca-period.js";
import type { OrderFills } from "./fill-orders.js";
import { moveOrder } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";
import { orderPush } from "./order-view-of.js";
import type { OrderStore } from "./ports.js";

/** The DCA orders' runner, which the schedule queue's timer runs: each call runs the due periods. */
export interface DcaOrders {
  /**
   * Runs every active DCA order's period that came by `atMs`, the instant the queue's run saw
   * (now when absent), so orders due together are judged alike. A fault of one order is thrown
   * once every other order ran.
   */
  run(options: { readonly signal: AbortSignal; readonly atMs?: number }): Promise<void>;
}

/** What the runner reads, moves, fills through and pushes to. */
export interface DcaOrdersParts {
  readonly orders: OrderStore;
  readonly fills: OrderFills;
  /** Where a token's decimals come from: the registry, else what its order's card stored. */
  readonly chains: ChainRegistry;
  readonly intents: Pick<IntentStore, "storedAssets">;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

const pageSize = 1_000;

type DcaOrder = OrderRecord & { readonly request: DcaOrderRequest };

// Keeps the order's next period, and the period whose buy goes to the fills with it, under the
// version it read; answers whether the write landed.
async function keep(
  parts: DcaOrdersParts,
  order: OrderRecord,
  call: { readonly nextAtMs: number; readonly buying?: number; readonly signal: AbortSignal },
): Promise<boolean> {
  const { nextAtMs, buying, signal } = call;
  const kept = dcaPeriodDocument.encode({ nextAtMs, ...(buying === undefined ? {} : { buying }) });
  const trigger = { type: "trigger_kept", triggerState: kept } as const;
  const move = moveOrder(order, trigger, parts.clock.now());
  const written = move.ok ? await parts.orders.move([move.value], { signal }) : null;
  return written?.ok === true;
}

// An order whose period no longer reads can never buy again: the owner hears why, and it ends.
async function endUnreadable(parts: DcaOrdersParts, order: OrderRecord, signal: AbortSignal) {
  await parts.fills.skip({ order: order.id, reason: "period_unreadable" }, { signal });
  const read = await parts.orders.get(order.id, { signal });
  const move =
    read === undefined
      ? undefined
      : moveOrder(read, { type: "cancel_requested" }, parts.clock.now());
  const written = move?.ok === true ? await parts.orders.move([move.value], { signal }) : undefined;
  const [cancelled] = written?.ok === true ? written.value : [];
  if (cancelled !== undefined) {
    parts.publish(orderPush(cancelled, "order/changed"));
  }
}

/** A period the queue hands to the fills: its order and when it was due. */
interface DuePeriod {
  readonly order: OrderRecord;
  readonly dueAtMs: number;
}

/** Where an order's period stands at an instant. */
type PeriodNow =
  /** Its cron or zone no longer reads. */
  | { readonly kind: "unreadable" }
  /** None is due; `keepFirst` is a new order's first period, to keep. */
  | { readonly kind: "ahead"; readonly keepFirst?: number }
  | { readonly kind: "due"; readonly dueAtMs: number; readonly following: number };

// A new order's first period is the first run after it became active.
function periodNow(order: DcaOrder, nowMs: number): PeriodNow {
  const kept = periodOf(order.triggerState)?.nextAtMs;
  const due = kept === undefined ? runAfter(order.request, order.changedAtMs) : ok(kept);
  const following = runAfter(order.request, nowMs);
  if (!due.ok || !following.ok) {
    return { kind: "unreadable" };
  }
  const dueAtMs = due.value;
  if (dueAtMs === undefined || following.value === undefined || dueAtMs > nowMs) {
    const isNew = kept === undefined && dueAtMs !== undefined;
    return isNew ? { kind: "ahead", keepFirst: dueAtMs } : { kind: "ahead" };
  }
  return { kind: "due", dueAtMs, following: following.value };
}

// The period that came due by `nowMs`, if one did, with the one after it kept first, so a stop
// never buys a period twice. A period already past its minute is recorded as missed.
async function planOne(
  parts: DcaOrdersParts,
  order: DcaOrder,
  call: { readonly nowMs: number; readonly signal: AbortSignal },
): Promise<DuePeriod | undefined> {
  const { nowMs, signal } = call;
  const now = periodNow(order, nowMs);
  if (now.kind === "unreadable") {
    await endUnreadable(parts, order, signal);
    return undefined;
  }
  if (now.kind === "ahead") {
    await (now.keepFirst === undefined
      ? Promise.resolve(false)
      : keep(parts, order, { nextAtMs: now.keepFirst, signal }));
    return undefined;
  }
  const { dueAtMs, following } = now;
  const isLate = isPeriodLate(dueAtMs, nowMs);
  const buying = isLate ? {} : { buying: dueAtMs };
  if (!(await keep(parts, order, { nextAtMs: following, ...buying, signal }))) {
    return undefined;
  }
  if (isLate) {
    await parts.fills.skip({ order: order.id, reason: "missed" }, { signal });
    return undefined;
  }
  return { order, dueAtMs };
}

// A period's buy; the fills judge its minute again at the head of the agent's line. A buy that
// could not run, behind a live fill still settling or a fill of the same order, is recorded so
// the period is never lost in silence; a token whose decimals nothing knows skips as failed.
async function buy(parts: DcaOrdersParts, due: DuePeriod, signal: AbortSignal): Promise<void> {
  const { order, dueAtMs } = due;
  const { token } = order.request;
  const decimals = (await knownAssetInfos(parts, [token], { signal }))[token]?.decimals;
  if (decimals === undefined) {
    await parts.fills.skip({ order: order.id, reason: "fill_failed" }, { signal });
    return;
  }
  const request = { order: order.id, price: { decimals }, period: { dueAtMs } };
  const outcome = await parts.fills.run(request, { signal });
  const after =
    outcome === "waiting" || outcome === "inactive"
      ? await parts.orders.get(order.id, { signal })
      : undefined;
  if (after?.state === "active") {
    await parts.fills.skip({ order: order.id, reason: "fill_waiting" }, { signal });
  }
}

// Every active DCA order, page after page until a page comes back empty.
async function activeDca(
  parts: DcaOrdersParts,
  signal: AbortSignal,
  after?: { readonly createdAtMs: number; readonly id: Id<"ord"> },
): Promise<readonly DcaOrder[]> {
  const base = { states: ["active" as const], limit: pageSize };
  const page = await parts.orders.list(after === undefined ? base : { ...base, after }, { signal });
  const last = page.at(-1);
  const dca = page.flatMap((order) => {
    const { request } = order;
    return request.kind === "dca" ? [{ ...order, request }] : [];
  });
  if (last === undefined) {
    return dca;
  }
  const cursor = { createdAtMs: last.createdAtMs, id: last.id };
  return [...dca, ...(await activeDca(parts, signal, cursor))];
}

/** The faults of one run, kept so every order runs before the first is thrown. */
interface RunFaults {
  readonly guard: <T>(work: () => Promise<T>) => Promise<T | undefined>;
  readonly throwFirst: () => void;
}

function runFaults(): RunFaults {
  const faults: Error[] = [];
  return {
    async guard(work) {
      try {
        return await work();
      } catch (error) {
        const fault =
          error instanceof Error
            ? error
            : new BinferenceError({ code: "engine.dca_run", message: "A DCA period failed." });
        faults.push(fault);
        return undefined;
      }
    },
    throwFirst() {
      const [first] = faults;
      if (first !== undefined) {
        throw first;
      }
    },
  };
}

/**
 * Creates the DCA orders' runner (decision 0246). Each run takes the active DCA orders and judges
 * them all at the run's instant: a period that came within the last minute buys once through the
 * order fills, with no card, in its order's mode and bounds, and must still be within its minute
 * when its buy reaches the head of its agent's line, else it is `late`; a period that came while
 * the order could not buy, the engine off or locked or its agent frozen, is `missed`; neither is
 * ever bought later. The buys start together; each agent's fills still run one at a time.
 */
export function createDcaOrders(parts: DcaOrdersParts): DcaOrders {
  return {
    async run({ signal, atMs }) {
      const nowMs = atMs ?? parts.clock.now();
      const faults = runFaults();
      const orders = await activeDca(parts, signal);
      const due: DuePeriod[] = [];
      for (const order of orders) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
        const planned = await faults.guard(async () => planOne(parts, order, { nowMs, signal }));
        if (planned !== undefined) {
          due.push(planned);
        }
      }
      await Promise.all(
        due.map(async (each) => faults.guard(async () => buy(parts, each, signal))),
      );
      faults.throwFirst();
    },
  };
}
