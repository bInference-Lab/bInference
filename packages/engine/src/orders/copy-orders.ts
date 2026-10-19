import {
  accountRefParts,
  type AssetRef,
  assetRefParts,
  canonicalAsset,
  type ChainRegistry,
} from "@binference/chain";
import { BinferenceError, type Clock, type Id } from "@binference/core";
import type { TrackedWalletStore } from "../leaders/ports.js";
import type { StoredActivity } from "../leaders/tracked-wallet-record.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { ReadTokenFacts } from "../money-path/token-facts.js";
import type { IntentStore } from "../ports.js";
import { asCopyOrder, type CopyOrder } from "./copy-fills.js";
import {
  copiedHeldOf,
  type CopyState,
  copyStateDocument,
  copyStateOf,
  type CopyTaking,
  passedState,
  takenState,
} from "./copy-state.js";
import { lostTakeOf } from "./copy-taken.js";
import { isLineHeld } from "./fill-faults.js";
import type { OrderFills } from "./fill-orders.js";
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
  readonly trackedWallets: Pick<TrackedWalletStore, "since">;
  /** The agents' live fills in flight, which hold a live order's line. */
  readonly intents: Pick<IntentStore, "fillsInFlight">;
  readonly chains: ChainRegistry;
  readonly readTokenFacts: ReadTokenFacts;
  readonly clock: Clock;
}

const pageSize = 1_000;
// The leader trades one read of an order takes; the next read goes on from the last.
const tradesPerRead = 50;

/** Every copy order in the given states, page after page. */
export async function copyOrdersIn(
  orders: Pick<OrderStore, "list">,
  call: {
    readonly states: readonly ("active" | "paused")[];
    readonly signal: AbortSignal;
    readonly after?: { readonly createdAtMs: number; readonly id: Id<"ord"> };
  },
): Promise<readonly CopyOrder[]> {
  const { states, signal, after } = call;
  const base = { states, limit: pageSize };
  const page = await orders.list(after === undefined ? base : { ...base, after }, { signal });
  const last = page.at(-1);
  const copies = page.flatMap((order) => asCopyOrder(order) ?? []);
  if (last === undefined) {
    return copies;
  }
  const cursor = { createdAtMs: last.createdAtMs, id: last.id };
  return [...copies, ...(await copyOrdersIn(orders, { states, signal, after: cursor }))];
}

// Whether the order copies the trade: a buy of a token other than the chain's coin and what the
// order spends, or a sale of a token the order holds from its own buys (decision 0260).
function isCopied(
  chains: ChainRegistry,
  call: { readonly order: CopyOrder; readonly state: CopyState; readonly asset: AssetRef },
  side: "buy" | "sell",
): boolean {
  const { order, state, asset } = call;
  const chain = chains.get(accountRefParts(order.request.trigger.leader).chain);
  if (!chain.ok || assetRefParts(asset).chain !== chain.value.ref) {
    return false;
  }
  if (side === "sell") {
    return copiedHeldOf(state, asset) > 0n;
  }
  return asset !== nativeAssetOf(chain.value) && asset !== order.request.spend;
}

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
  call: { readonly taking: CopyTaking; readonly signal: AbortSignal },
): Promise<boolean> {
  const { order, state } = reading;
  const { taking, signal } = call;
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
  const taking: CopyTaking = {
    id: trade.id,
    side: trade.side,
    asset,
    atMs: trade.atMs,
    takenAtMs: parts.clock.now(),
    ...share,
    ...paidOf(parts.chains, trade),
    ...(facts === undefined ? {} : { facts }),
  };
  return fillTaken(parts, reading, { taking, signal });
}

// A leader sale a stop cut off between its take and its fill is still sold, late, once: taken
// again now, as no row and no live fill shows it ran (decision 0260).
async function sellLost(parts: CopyOrdersParts, reading: Reading, signal: AbortSignal) {
  const lost = await lostTakeOf(parts, reading.order, signal);
  if (lost?.side !== "sell") {
    return true;
  }
  const taking = { ...lost, takenAtMs: parts.clock.now() };
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

// Copies or passes over each trade in turn; answers where the order stands after the last, or
// none once it cannot go on.
async function copyTrades(
  parts: CopyOrdersParts,
  reading: Reading,
  call: { readonly trades: readonly StoredActivity[]; readonly signal: AbortSignal },
): Promise<Reading | undefined> {
  const [trade, ...rest] = call.trades;
  const { signal } = call;
  if (trade === undefined) {
    return reading;
  }
  const asset = canonicalAsset(parts.chains, trade.asset);
  if (!asset.ok || !isCopied(parts.chains, { ...reading, asset: asset.value }, trade.side)) {
    return copyTrades(parts, { ...reading, passedTo: trade.id }, { trades: rest, signal });
  }
  const goesOn = await copyOne(parts, reading, { trade, asset: asset.value, signal });
  const next = goesOn ? await readingOf(parts, reading.order.id, signal) : undefined;
  return next === undefined ? undefined : copyTrades(parts, next, { trades: rest, signal });
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
  const trades = await parts.trackedWallets.since(query, { signal });
  const reading = await copyTrades(parts, start, { trades, signal });
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

// Copies one order's trades, read after read, until none is left or it cannot go on; a sale a
// stop cut off goes first.
async function copyOrder(parts: CopyOrdersParts, id: Id<"ord">, signal: AbortSignal) {
  const first = await readingOf(parts, id, signal);
  const isSold = first !== undefined && (await sellLost(parts, first, signal));
  const reading = isSold ? await readingOf(parts, id, signal) : undefined;
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
