import { type AssetRef, canonicalAsset, type ChainRegistry } from "@binference/chain";
import { BinferenceError, type Clock, type Id } from "@binference/core";
import type { TrackedWalletStore } from "../leaders/ports.js";
import type { StoredActivity } from "../leaders/tracked-wallet-record.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { ReadTokenFacts } from "../money-path/token-facts.js";
import type { IntentStore } from "../ports.js";
import { asCopyOrder, type CopyOrder } from "./copy-fills.js";
import { copyOrdersIn } from "./copy-orders-in.js";
import { honestHeldState, type OutsideSaleParts } from "./copy-outside-sales.js";
import {
  type CopyState,
  copyStateDocument,
  copyStateOf,
  type CopyTaking,
  endedState,
  passedState,
  takenState,
} from "./copy-state.js";
import { isRetryLapsed, retryAtOf, type TakeEnd, takeEndOf } from "./copy-takes.js";
import { confirmedBlockOf, type CopyFilterParts, isCopied } from "./copy-trade-filter.js";
import { isLineHeld } from "./fill-faults.js";
import type { OrderFills } from "./fill-orders.js";
import { type InstallAccountParts, isInstallAccount } from "./install-accounts.js";
import { moveOrder } from "./order-machine.js";
import type { OrderStore } from "./ports.js";

/** The copy orders' runner: each run copies the leader trades stored since each order's last. */
export interface CopyOrders {
  /**
   * Takes, for each active copy order, its leader's trades stored since the last one it took, in
   * order, and fills each it copies through the order fills. A fault of one order is thrown once
   * every other order ran.
   */
  run(options: { readonly signal: AbortSignal }): Promise<void>;
}

/** What the runner reads, moves and fills through. */
export interface CopyOrdersParts {
  readonly orders: OrderStore;
  readonly fills: OrderFills;
  readonly trackedWallets: Pick<TrackedWalletStore, "since" | "cursor">;
  /** The agents' live fills in flight, which hold a live order's line. */
  readonly intents: Pick<IntentStore, "fillsInFlight" | "get">;
  readonly chains: ChainRegistry;
  /** The quote assets, whose buys no copy order follows (decision 0260). */
  readonly quotes: CopyFilterParts["quotes"];
  /** The install's wallets and their accounts: a leader that became one is not followed. */
  readonly install: InstallAccountParts["install"];
  readonly custody: InstallAccountParts["custody"];
  /** The wallets' executions, whose sales outside the copy orders lower a copy holding. */
  readonly positions: OutsideSaleParts["positions"];
  readonly readTokenFacts: ReadTokenFacts;
  readonly clock: Clock;
}

// The leader trades one read of an order takes; the next read goes on from the last.
const tradesPerRead = 50;

// The token's symbol, name and decimals: the registry's, else what its contract answers now;
// none when it answers none.
async function factsOf(
  parts: CopyOrdersParts,
  asset: AssetRef,
  signal: AbortSignal,
): Promise<CopyTaking["facts"]> {
  const listed = assetInfoOf(parts.chains, asset);
  if (listed !== undefined) {
    return { symbol: listed.symbol, name: listed.name, decimals: listed.decimals, verified: true };
  }
  const read = (await parts.readTokenFacts([asset], { signal })).get(asset);
  return read === undefined ? undefined : { ...read, verified: false };
}

// Writes the order's new state under the version it read; answers the order after it, or none
// when another write moved it first.
async function keep(
  parts: CopyOrdersParts,
  order: CopyOrder,
  call: { readonly state: CopyState; readonly signal: AbortSignal },
): Promise<CopyOrder | undefined> {
  const triggerState = copyStateDocument.encode(call.state);
  const move = moveOrder(order, { type: "trigger_kept", triggerState }, parts.clock.now());
  const written = move.ok ? await parts.orders.move([move.value], { signal: call.signal }) : null;
  const [kept] = written?.ok === true ? written.value : [];
  return kept === undefined ? undefined : asCopyOrder(kept);
}

/** Where an order's run stands: the order as read last, and the trades it passed over. */
interface Reading {
  readonly order: CopyOrder;
  readonly state: CopyState;
  /** The last trade it passed over and has not kept yet. */
  readonly passedTo?: number;
}

// What the leader paid for a buy, in its canonical form; none for a sale, or an asset no chain of
// the registry holds, which leaves the buy unvalued.
function paidOf(chains: ChainRegistry, trade: StoredActivity): Pick<CopyTaking, "paid"> {
  const asset = canonicalAsset(chains, trade.counterAsset);
  return trade.side === "buy" && asset.ok
    ? { paid: { asset: asset.value, base: trade.counterAmount } }
    : {};
}

// Keeps the trade as taken and fills it; answers whether the order may go on to the next. A fill
// that could not run, behind a fill still settling, records `fill_waiting`, so no taken trade is
// lost in silence.
async function fillTaken(
  parts: CopyOrdersParts,
  reading: Reading,
  call: { readonly taking: Omit<CopyTaking, "take">; readonly signal: AbortSignal },
): Promise<boolean> {
  const { order } = reading;
  const { taking, signal } = call;
  // A sale counts first what the wallet sold of the token outside the copy orders (decision 0260).
  const state =
    taking.side === "sell"
      ? await honestHeldState(parts, { order, state: reading.state, asset: taking.asset, signal })
      : reading.state;
  const taken = await keep(parts, order, { state: takenState(state, taking), signal });
  if (taken === undefined) {
    return false;
  }
  const outcome = await parts.fills.run({ order: order.id, price: { decimals: 0 } }, { signal });
  if (outcome === "waiting" || outcome === "inactive") {
    const after = await parts.orders.get(order.id, { signal });
    if (after?.state === "active") {
      await parts.fills.skip({ order: order.id, reason: "fill_waiting" }, { signal });
    }
  }
  return outcome !== "sent";
}

// Takes one trade the order copies and fills it; answers whether the order may go on.
async function copyOne(
  parts: CopyOrdersParts,
  reading: Reading,
  call: { readonly trade: StoredActivity; readonly asset: AssetRef; readonly signal: AbortSignal },
): Promise<boolean> {
  const { trade, asset, signal } = call;
  if (await isLineHeld(parts, reading.order, signal)) {
    return false;
  }
  const facts = await factsOf(parts, asset, signal);
  const share = trade.shareSoldBps === undefined ? {} : { shareSoldBps: trade.shareSoldBps };
  const taking: Omit<CopyTaking, "take"> = {
    id: trade.id,
    txHash: trade.txHash,
    side: trade.side,
    asset,
    atMs: trade.atMs,
    ...share,
    ...paidOf(parts.chains, trade),
    ...(facts === undefined ? {} : { facts }),
  };
  return fillTaken(parts, reading, { taking, signal });
}

// The order as it stands now, with its state; none once it stopped being an active copy order.
async function readingOf(
  parts: CopyOrdersParts,
  id: Id<"ord">,
  signal: AbortSignal,
): Promise<Reading | undefined> {
  const read = await parts.orders.get(id, { signal });
  const order = read?.state === "active" ? asCopyOrder(read) : undefined;
  const state = copyStateOf(order?.triggerState);
  return order === undefined || state === undefined ? undefined : { order, state };
}

// The row a take that ended with none of its own still needs: a buy a stop cut off is `missed`, a
// sale with no room to wait is `copy_sale_lapsed`.
function endReasonOf(call: {
  readonly taking: CopyTaking;
  readonly end: TakeEnd;
  readonly isUnsold: boolean;
  readonly dueAtMs: number | undefined;
}): "missed" | "copy_sale_lapsed" | undefined {
  const { taking, end, isUnsold, dueAtMs } = call;
  if (end.kind === "lost" && taking.side === "buy") {
    return "missed";
  }
  return isUnsold && dueAtMs === undefined ? "copy_sale_lapsed" : undefined;
}

// Ends the order's current take as its rows say (decision 0260): a buy a stop cut off is recorded
// as `missed`; a sale a stop cut off, or skipped for a passing reason, waits to be sold again, else
// is given up with `copy_sale_lapsed`. Answers where the order stands, or none while its agent's
// live fill runs or another write moved it.
async function settleTake(
  parts: CopyOrdersParts,
  reading: Reading,
  signal: AbortSignal,
): Promise<Reading | undefined> {
  const { order, state } = reading;
  const { taking } = state;
  if (taking === undefined) {
    return reading;
  }
  const end = await takeEndOf(parts, { order, taking, signal });
  if (end.kind === "open") {
    return undefined;
  }
  const isUnsold = taking.side === "sell" && end.kind !== "done";
  const dueAtMs = isUnsold ? retryAtOf(end, state, parts.clock.now()) : undefined;
  const reason = endReasonOf({ taking, end, isUnsold, dueAtMs });
  if (reason !== undefined) {
    await parts.fills.skip({ order: order.id, reason }, { signal });
  }
  const ended = endedState(state, dueAtMs === undefined ? {} : { dueAtMs });
  const kept = await keep(parts, order, { state: ended, signal });
  return kept === undefined ? undefined : { order: kept, state: ended };
}

// Sells again each leader sale whose minute came, the oldest first, or gives up one past its hour
// with `copy_sale_lapsed` (the owner's choice, decision 0260).
async function sellAgain(
  parts: CopyOrdersParts,
  reading: Reading,
  signal: AbortSignal,
): Promise<Reading | undefined> {
  const nowMs = parts.clock.now();
  const due = reading.state.retries.find(({ dueAtMs }) => dueAtMs <= nowMs);
  if (due === undefined) {
    return reading;
  }
  const { dueAtMs: _due, ...taking } = due;
  if (isRetryLapsed(due, nowMs)) {
    const taken = takenState(reading.state, taking);
    const kept = await keep(parts, reading.order, { state: taken, signal });
    if (kept !== undefined) {
      await parts.fills.skip({ order: kept.id, reason: "copy_sale_lapsed" }, { signal });
    }
  } else if (!(await fillTaken(parts, reading, { taking, signal }))) {
    return undefined;
  }
  const next = await readingOf(parts, reading.order.id, signal);
  const settled = next === undefined ? undefined : await settleTake(parts, next, signal);
  return settled === undefined ? undefined : sellAgain(parts, settled, signal);
}

// Copies or passes over each trade in turn; answers where the order stands after the last, or
// none once it cannot go on.
async function copyTrades(
  parts: CopyOrdersParts,
  reading: Reading,
  call: {
    readonly trades: readonly StoredActivity[];
    readonly deepest: bigint;
    readonly isOwn: boolean;
    readonly signal: AbortSignal;
  },
): Promise<Reading | undefined> {
  const [trade, ...rest] = call.trades;
  const { signal } = call;
  if (trade === undefined) {
    return reading;
  }
  // A trade not yet deep enough waits, with every trade after it, for a later run.
  if (trade.block > call.deepest) {
    return reading;
  }
  const asset = canonicalAsset(parts.chains, trade.asset);
  const seen = asset.ok
    ? { txHash: trade.txHash, side: trade.side, asset: asset.value }
    : undefined;
  if (seen === undefined || call.isOwn || !isCopied(parts, reading, seen)) {
    return copyTrades(parts, { ...reading, passedTo: trade.id }, { ...call, trades: rest });
  }
  const goesOn = await copyOne(parts, reading, { trade, asset: seen.asset, signal });
  const next = goesOn ? await readingOf(parts, reading.order.id, signal) : undefined;
  const settled = next === undefined ? undefined : await settleTake(parts, next, signal);
  return settled === undefined ? undefined : copyTrades(parts, settled, { ...call, trades: rest });
}

// Copies the next trades of one read; answers whether another read may follow.
async function copyRead(
  parts: CopyOrdersParts,
  start: Reading,
  signal: AbortSignal,
): Promise<boolean> {
  const { order, state } = start;
  const query = {
    account: order.request.trigger.leader,
    afterId: state.through,
    fromMs: state.sinceMs,
    limit: tradesPerRead,
  };
  const deepest = await confirmedBlockOf(parts, order, signal);
  if (deepest === undefined) {
    return false;
  }
  const trades = await parts.trackedWallets.since(query, { signal });
  // A leader that became a wallet of the install since the order was made, as a wallet attached
  // from another machine may, is followed no more: each of its trades is passed over (decision 0261).
  const isOwn = trades.length > 0 && (await isInstallAccount(parts, query.account, signal));
  const reading = await copyTrades(parts, start, { trades, deepest, isOwn, signal });
  if (reading === undefined) {
    return false;
  }
  const { passedTo } = reading;
  const passed =
    passedTo === undefined
      ? reading.order
      : await keep(parts, reading.order, { state: passedState(reading.state, passedTo), signal });
  return passed !== undefined && trades.length === tradesPerRead;
}

// Copies one order's trades, read after read, until none is left or it cannot go on: its last take
// ends first, then the sales whose minute to be sold again came. While its agent's live fill
// settles, the order reads nothing: a leader sale of a token its own buy is still landing would
// find no holding and be passed over (decision 0260).
async function copyOrder(parts: CopyOrdersParts, id: Id<"ord">, signal: AbortSignal) {
  const first = await readingOf(parts, id, signal);
  if (first === undefined || (await isLineHeld(parts, first.order, signal))) {
    return;
  }
  const settled = await settleTake(parts, first, signal);
  const reading = settled === undefined ? undefined : await sellAgain(parts, settled, signal);
  if (reading !== undefined && (await copyRead(parts, reading, signal))) {
    await copyOrder(parts, id, signal);
  }
}

/**
 * Creates the copy orders' runner (decision 0260). Each run reads every active copy order's
 * leader trades stored since the last one it took, oldest first: a trade it copies is kept as
 * taken in the order's state, then filled through the order fills, with no card, in the order's
 * mode and bounds; a trade it does not copy is passed over. The orders run together; each agent's
 * fills still run one at a time, and a live order waits while its agent's live fill settles.
 */
export function createCopyOrders(parts: CopyOrdersParts): CopyOrders {
  return {
    async run({ signal }) {
      const orders = await copyOrdersIn(parts.orders, { states: ["active"], signal });
      const faults: Error[] = [];
      await Promise.all(
        orders.map(async (order) => {
          try {
            await copyOrder(parts, order.id, signal);
          } catch (error) {
            const fault =
              error instanceof Error
                ? error
                : new BinferenceError({ code: "engine.copy_run", message: "A copy order failed." });
            faults.push(fault);
          }
        }),
      );
      const [first] = faults;
      if (first !== undefined) {
        throw first;
      }
    },
  };
}
