import type { AssetRef } from "@binference/chain";
import { blockAfter } from "@binference/chain-evm/fork";
import { pairAmountOut, type PairReserves } from "@binference/chain-evm/replay";
import type { Id } from "@binference/core";
import { type QuoteView, quoteViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import {
  type ExitOrders,
  type ExitReplay,
  type HeadsBy,
  replayDay,
  replayExits,
  type TimedFill,
} from "./exit-replay-rig.js";
import { blockTimeMs } from "./fork-price-watch.js";

// The recorded day replayed on the fork at the chain's pace, with a take-profit, a stop-loss and a
// trailing stop on each of BTCB, ETH and Cake, filled on paper with no runtime running. Each fill
// must be written within one block time of the block whose price triggered it, before the replay
// mines the next block, at the first block its trigger allowed, and inside its order's bounds.

type ExitKind = "takeProfit" | "stopLoss" | "trailing";
const kinds: readonly ExitKind[] = ["takeProfit", "stopLoss", "trailing"];
// The slippage each exit allows: the agent's for a registry token, as the fork's limits set it,
// and the take-profits' own.
const slippageBps: Readonly<Record<ExitKind, bigint>> = {
  takeProfit: 10n,
  stopLoss: 100n,
  trailing: 100n,
};
const exitShareBps = 3_000n;
const whole = 10n ** 18n;

/** One exit order's fill, as the replay measured it. */
interface Measured {
  readonly label: string;
  readonly kind: ExitKind;
  readonly fill: TimedFill;
  readonly quote: QuoteView;
  /** Blocks from the trigger's block to the first block the replay mined after the fill. */
  readonly blocks: bigint;
  /** From the trigger's block being mined to the fill written, and the steps between. */
  readonly totalMs: number;
  readonly headMs: number;
  readonly readMs: number;
  readonly fillMs: number;
}

// Micro-dollars for a whole token, BNB at $600 as the rig prices it, from base units of WBNB out
// for base units of the token in; both have 18 decimals.
function usdPerWhole(
  quoteOut: bigint,
  tokenIn: bigint,
): { readonly n: bigint; readonly d: bigint } {
  return { n: quoteOut * 600n * whole, d: tokenIn * 10n ** 12n };
}

const atLeast = (price: { readonly n: bigint; readonly d: bigint }, level: bigint): boolean =>
  price.n >= level * price.d;
const atMost = (price: { readonly n: bigint; readonly d: bigint }, level: bigint): boolean =>
  price.n <= level * price.d;

// Whether an exit's trigger allowed it at a block's reserves: a stop-loss or a trailing stop at the
// pool's price, a take-profit at the pool's price and at its own quote's least out for `amountIn`
// (decision 0197). `peak` is the trailing stop's highest pool price so far.
function allows(
  exit: { readonly kind: ExitKind; readonly orders: ExitOrders; readonly amountIn: bigint },
  price: PairReserves,
  peak: PairReserves,
): boolean {
  const pool = usdPerWhole(price.reserveQuote, price.reserveToken);
  if (exit.kind === "stopLoss") {
    return atMost(pool, exit.orders.stopLossUsd);
  }
  if (exit.kind === "trailing") {
    const keep = BigInt(10_000 - exit.orders.trailingBps);
    return (
      price.reserveQuote * peak.reserveToken * 10_000n <=
      peak.reserveQuote * price.reserveToken * keep
    );
  }
  const out = pairAmountOut(exit.amountIn, price.reserveToken, price.reserveQuote);
  const leastOut = (out * (10_000n - slippageBps.takeProfit)) / 10_000n;
  return (
    atLeast(pool, exit.orders.takeProfitUsd) &&
    atLeast(usdPerWhole(leastOut, exit.amountIn), exit.orders.takeProfitUsd)
  );
}

// The first replayed block whose reserves allowed the exit, the trailing stop's peak starting at
// the pool's price before the replay.
function firstAllowed(
  replayed: ExitReplay,
  exit: {
    readonly pool: number;
    readonly kind: ExitKind;
    readonly orders: ExitOrders;
    readonly amountIn: bigint;
  },
): bigint | undefined {
  let peak = replayed.replay.pools[exit.pool]?.start;
  for (const block of replayed.blocks) {
    const price = block.prices[exit.pool];
    if (price !== undefined && peak !== undefined) {
      const isHigher =
        price.reserveQuote * peak.reserveToken > peak.reserveQuote * price.reserveToken;
      peak = isHigher ? price : peak;
      if (allows(exit, price, peak)) {
        return block.number;
      }
    }
  }
  return undefined;
}

async function quoteOf(
  replayed: ExitReplay,
  order: Id<"ord">,
  signal: AbortSignal,
): Promise<QuoteView[]> {
  const { stores } = replayed.rig;
  const rows = await stores.orders.fills({ orderId: order, limit: 10 }, { signal });
  const filled = rows.filter(({ outcome }) => outcome === "filled");
  return Promise.all(
    filled.map(async ({ intentId }) => {
      const intent =
        intentId === undefined ? undefined : await stores.intents.get(intentId, { signal });
      return quoteViewSchema.parse(intent?.quote);
    }),
  );
}

/** Every exit order's fills and what they measured. */
// One exit's count of fills and, when it filled, what its fill measured.
async function measureOne(
  replayed: ExitReplay,
  exit: { readonly pool: number; readonly kind: ExitKind },
  signal: AbortSignal,
): Promise<{ readonly count: string; readonly row?: Measured }> {
  const { pool, kind } = exit;
  const order = replayed.orders[pool]?.[kind];
  const label = `${replayDay.pools[pool]?.symbol ?? "?"} ${kind}`;
  const quotes = order === undefined ? [] : await quoteOf(replayed, order, signal);
  const fills = replayed.fills.filter((item) => item.order === order && item.outcome === "filled");
  const count = `${label}: ${String(fills.length)} fill(s), ${String(quotes.length)} written`;
  const [fill] = fills;
  const [quote] = quotes;
  const mined = replayed.blocks.find(({ number }) => number === fill?.block);
  if (fill === undefined || quote === undefined || mined === undefined) {
    return { count };
  }
  const headAtMs = fill.headAtMs ?? fill.readAtMs;
  const row: Measured = {
    label,
    kind,
    fill,
    quote,
    blocks: blockAfter(replayed.blocks, fill.endedAtMs) - fill.block,
    totalMs: fill.endedAtMs - mined.minedAtMs,
    headMs: headAtMs - mined.minedAtMs,
    readMs: fill.readAtMs - headAtMs,
    fillMs: fill.endedAtMs - fill.readAtMs,
  };
  return { count, row };
}

/** Every exit order's count of fills, and what each fill measured. */
async function measure(replayed: ExitReplay, signal: AbortSignal) {
  const exits = replayed.orders.flatMap((_, pool) => kinds.map((kind) => ({ pool, kind })));
  const measured = await Promise.all(exits.map(async (exit) => measureOne(replayed, exit, signal)));
  return {
    rows: measured.flatMap(({ row }) => (row === undefined ? [] : [row])),
    counts: measured.map(({ count }) => count),
  };
}

function table(heads: HeadsBy, replayed: ExitReplay, rows: readonly Measured[]): string {
  const lines = rows.map(
    (row) =>
      `${row.label}: block ${String(row.fill.block)}, ${String(row.blocks)} block(s) to fill, ` +
      `${String(row.totalMs)} ms = head ${String(row.headMs)} + read ${String(row.readMs)} + fill ${String(row.fillMs)}`,
  );
  return [`${heads}: ${String(replayed.blocks.length)} replayed blocks`, ...lines].join("\n");
}

/** What the paper wallet held of each token before each sale, from its buy and the sales before. */
async function heldBefore(replayed: ExitReplay, rows: readonly Measured[], signal: AbortSignal) {
  const buys = await replayed.rig.stores.intents.list(
    { states: ["paper_filled"], limit: 50 },
    { signal },
  );
  const held = new Map<AssetRef, bigint>();
  for (const intent of buys.filter(({ kind }) => kind === "buy")) {
    const { expectedOut } = quoteViewSchema.parse(intent.quote);
    held.set(expectedOut.asset, (held.get(expectedOut.asset) ?? 0n) + expectedOut.base);
  }
  const before = new Map<Measured, bigint>();
  for (const row of rows.toSorted((a, b) => a.fill.endedAtMs - b.fill.endedAtMs)) {
    const { asset, base } = row.quote.amountIn;
    before.set(row, held.get(asset) ?? 0n);
    held.set(asset, (held.get(asset) ?? 0n) - base);
  }
  return before;
}

// Each bound a sale broke: its size, its slippage, its worst price, and a take-profit's level at
// its expected price.
function brokenBounds(row: Measured, orders: ExitOrders, held: bigint): readonly string[] {
  const { amountIn, expectedOut, minOut } = row.quote;
  const levels = { takeProfit: orders.takeProfitUsd, stopLoss: orders.stopLossUsd, trailing: 0n };
  const worst = row.kind === "takeProfit" ? levels.takeProfit : (orders.worstUsd[row.kind] ?? 0n);
  const broken = [
    amountIn.base > 0n && amountIn.base <= (held * exitShareBps) / 10_000n ? "" : "size",
    minOut.base * 10_000n >= expectedOut.base * (10_000n - slippageBps[row.kind]) ? "" : "slippage",
    atLeast(usdPerWhole(minOut.base, amountIn.base), worst) ? "" : "worst price",
    row.kind !== "takeProfit" ||
    atLeast(usdPerWhole(expectedOut.base, amountIn.base), levels.takeProfit)
      ? ""
      : "level",
  ];
  return broken.filter((reason) => reason !== "").map((reason) => `${row.label}: ${reason}`);
}

async function replayWith(
  heads: HeadsBy,
  context: {
    readonly signal: AbortSignal;
    readonly annotate: (message: string) => Promise<unknown>;
  },
) {
  const { signal, annotate } = context;
  let report = {
    rows: [] as readonly Measured[],
    counts: [] as readonly string[],
    late: [] as readonly string[],
    broken: [] as readonly string[],
  };
  await replayExits(signal, heads, async (replayed) => {
    const { rows, counts } = await measure(replayed, signal);
    await annotate(table(heads, replayed, rows));
    const held = await heldBefore(replayed, rows, signal);
    const byOrder = new Map(
      replayed.orders.flatMap((orders, pool) =>
        kinds.map((kind) => [orders[kind], { pool, kind, orders }] as const),
      ),
    );
    const late = rows.flatMap((row) => {
      const exit = byOrder.get(row.fill.order);
      const first =
        exit === undefined
          ? undefined
          : firstAllowed(replayed, { ...exit, amountIn: row.quote.amountIn.base });
      return first === row.fill.block
        ? []
        : [`${row.label}: fired at ${String(row.fill.block)}, first allowed ${String(first)}`];
    });
    const broken = rows.flatMap((row) => {
      const exit = byOrder.get(row.fill.order);
      return exit === undefined
        ? [`${row.label}: no order`]
        : brokenBounds(row, exit.orders, held.get(row) ?? 0n);
    });
    report = { rows, counts, late, broken };
  });
  return report;
}

describe("exit orders on a replayed day", () => {
  it("fills each exit in the block after its trigger with new heads pushed", async (context) => {
    const { rows, counts, late, broken } = await replayWith("subscription", context);

    expect(counts).toStrictEqual(
      replayDay.pools.flatMap(({ symbol }) =>
        kinds.map((kind) => `${symbol} ${kind}: 1 fill(s), 1 written`),
      ),
    );
    expect(rows.filter(({ blocks }) => blocks !== 1n).map(({ label }) => label)).toStrictEqual([]);
    expect(
      rows.filter(({ totalMs }) => totalMs >= blockTimeMs).map(({ label }) => label),
    ).toStrictEqual([]);
    expect(late).toStrictEqual([]);
    expect(broken).toStrictEqual([]);
  });

  // A poll every block time sees a block up to a block time after it was mined, at a phase the
  // poll and the chain drift through, so a fill lands one or two blocks after its trigger
  // (decision 0209).
  it("fills each exit within two blocks of its trigger with heads polled", async (context) => {
    const { rows, counts, late, broken } = await replayWith("polling", context);

    expect(counts).toStrictEqual(
      replayDay.pools.flatMap(({ symbol }) =>
        kinds.map((kind) => `${symbol} ${kind}: 1 fill(s), 1 written`),
      ),
    );
    expect(rows.filter(({ blocks }) => blocks > 2n).map(({ label }) => label)).toStrictEqual([]);
    expect(
      rows.filter(({ fillMs }) => fillMs >= blockTimeMs).map(({ label }) => label),
    ).toStrictEqual([]);
    expect(late).toStrictEqual([]);
    expect(broken).toStrictEqual([]);
  });
});
