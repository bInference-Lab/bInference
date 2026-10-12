import { setTimeout as wait } from "node:timers/promises";
import type { PriceWatcher, WatchedPrice } from "@binference/chain-evm";
import type { Fork } from "@binference/chain-evm/fork";
import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { blockTimeMs, orderPriceOf, watcherOn } from "./fork-price-watch.js";
import { confirmedOrder, type FillRig, fillAgent, onFillFork, xvs } from "./order-fill-rig.js";

/** A fill that a price at a block triggered: when the price was read, and when the fill ended. */
interface Timed {
  readonly block: bigint;
  readonly readAtMs: number;
  readonly endedAtMs: number;
  readonly outcomes: readonly string[];
}

// Hands each read price to the engine's triggers at once, in the block's own processing, and
// keeps when each price was read and when the fills it started ended.
function handOn(rig: FillRig, watcher: PriceWatcher, signal: AbortSignal): Timed[] {
  const timed: Timed[] = [];
  const see = async (price: WatchedPrice): Promise<void> => {
    const outcomes = await rig.engine.seePrice(orderPriceOf(price), { signal });
    const ended = { block: price.block, readAtMs: price.atMs, endedAtMs: Date.now() };
    timed.push({ ...ended, outcomes: outcomes.map(({ outcome }) => outcome) });
  };
  watcher.onPrice((price) => {
    void see(price);
  });
  return timed;
}

// Mines a block a block time, until a price read after the first `from` prices led to a fill.
async function fillAtNextBlock(
  fork: Fork,
  watched: { readonly timed: readonly Timed[]; readonly from: number },
  signal: AbortSignal,
): Promise<Timed> {
  await fork.call("evm_mine", []);
  await wait(blockTimeMs, undefined, { signal });
  const found = watched.timed
    .slice(watched.from)
    .find(({ outcomes }) => outcomes.includes("filled"));
  return found ?? fillAtNextBlock(fork, watched, signal);
}

// A limit buy of 0.02 BNB of the rig's token, which any price triggers, up to a million dollars a
// token: the worst price defaults to the trigger's otherwise (decision 0197).
async function anyPriceBuy(rig: FillRig, signal: AbortSignal): Promise<void> {
  await confirmedOrder(
    rig,
    {
      kind: "limit",
      agent: fillAgent,
      token: rig.token,
      side: "buy",
      size: { base: 2n * 10n ** 16n },
      trigger: { price: 1n, direction: "above" },
      worstPrice: 10n ** 12n,
      reason: "Buy the token at any price",
    },
    signal,
  );
}

// A take-profit that sells all of the rig's token at any price above a micro-dollar.
async function anyPriceTakeProfit(rig: FillRig, signal: AbortSignal): Promise<void> {
  await confirmedOrder(
    rig,
    {
      kind: "takeProfit",
      agent: fillAgent,
      token: rig.token,
      side: "sell",
      size: { percentBps: bpsSchema.parse(10_000) },
      trigger: { price: 1n },
      reason: "Take the profit at any price",
    },
    signal,
  );
}

describe("price triggers on a BSC fork", () => {
  it("fills a paper take-profit within a block of the price that triggered it", async ({
    signal,
  }) =>
    onFillFork(signal, { token: xvs, flags: [] }, async (rig, fork) => {
      const watcher = watcherOn(fork);
      const stop = new AbortController();
      const timed = handOn(rig, watcher, stop.signal);
      watcher.watch(rig.token);
      const running = watcher.run(stop.signal).catch(() => undefined);
      try {
        // A buy fills the paper position and reads the fork's state of the pair, the router and
        // the token, as a running engine has it; the take-profit that sells it is timed.
        await anyPriceBuy(rig, signal);
        await fillAtNextBlock(fork, { timed, from: 0 }, signal);
        const bought = timed.length;
        await anyPriceTakeProfit(rig, signal);
        const measured = await fillAtNextBlock(fork, { timed, from: bought }, signal);

        expect(measured.endedAtMs - measured.readAtMs).toBeLessThan(blockTimeMs);
        const query = { states: ["paper_filled" as const], limit: 5 };
        const filled = await rig.stores.intents.list(query, { signal });
        expect(filled.map(({ kind }) => kind)).toStrictEqual(["buy", "sell"]);
      } finally {
        stop.abort();
        await running;
      }
    }));
});
