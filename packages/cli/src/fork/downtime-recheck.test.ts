import { setTimeout as wait } from "node:timers/promises";
import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { bpsSchema, type Id } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { DowntimeReport } from "@binference/engine/orders";
import { noticeSchema } from "@binference/engine/surfaces";
import type { OrderRequest } from "@binference/protocol";
import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { blockTimeMs, orderPriceOf, watcherOn } from "./fork-price-watch.js";
import { confirmedOrder, type FillRig, fillAgent, onFillFork, xvs } from "./order-fill-rig.js";

const wholeToken = 10n ** 18n;
const pumpWei = 400n * 10n ** 18n;

// Hands each price the watcher reads to `engine` with the time it was read, until `stop`.
async function watchFor(
  fork: Fork,
  run: { readonly rig: FillRig; readonly engine: Engine; readonly stop: AbortSignal },
): Promise<{ readonly prices: bigint[]; readonly running: Promise<void> }> {
  const watcher = watcherOn(fork);
  const prices: bigint[] = [];
  watcher.onPrice((price) => {
    const seen = orderPriceOf(price);
    prices.push((seen.usdPerBaseUnit.numerator * wholeToken) / seen.usdPerBaseUnit.denominator);
    void run.engine.seePrice(seen, { signal: run.stop }).catch(() => undefined);
  });
  watcher.watch(run.rig.token);
  const running = watcher.run(run.stop).catch(() => undefined);
  return { prices, running };
}

// Mines a block a block time until `done` holds.
async function mineUntil(fork: Fork, done: () => Promise<boolean>, signal: AbortSignal) {
  await fork.call("evm_mine", []);
  await wait(blockTimeMs, undefined, { signal });
  if (!(await done())) {
    await mineUntil(fork, done, signal);
  }
}

// The fork's own account buys XVS with BNB on its PancakeSwap v2 pair: the price rises.
async function pumpXvs(fork: Fork): Promise<void> {
  const data = encodeFunctionData({
    abi: parseAbi([
      "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
    ]),
    functionName: "swapExactETHForTokens",
    args: [0n, [bscToken("WBNB"), xvs], fork.account, BigInt(Math.floor(Date.now() / 1_000) + 600)],
  });
  const router = bscContract("pancakeswap", "v2-router");
  await fork.call("anvil_setBalance", [fork.account, `0x${(pumpWei * 2n).toString(16)}`]);
  await fork.send({ from: fork.account, to: router, value: pumpWei, data });
}

// The exit orders of the test, at `micros` a whole XVS now: a take-profit 5% up and a limit sale
// 5% up that asks 100 times the price, which a pump makes hold; a stop-loss 10% down, which holds
// neither before nor after it.
function exits(rig: FillRig, micros: bigint): readonly OrderRequest[] {
  const base = {
    agent: fillAgent,
    token: rig.token,
    side: "sell",
    size: { percentBps: bpsSchema.parse(4_000) },
    reason: "Exit around the downtime",
  } as const;
  const up = (micros * 105n) / 100n;
  return [
    { ...base, kind: "takeProfit", trigger: { price: up } },
    { ...base, kind: "stopLoss", trigger: { price: (micros * 90n) / 100n } },
    {
      ...base,
      kind: "limit",
      trigger: { price: up, direction: "above" },
      worstPrice: micros * 100n,
    },
  ];
}

// A paper buy of 0.05 BNB of XVS at any price, filled at the next block.
async function buyXvs(fork: Fork, rig: FillRig, signal: AbortSignal): Promise<void> {
  await confirmedOrder(
    rig,
    {
      kind: "limit",
      agent: fillAgent,
      token: rig.token,
      side: "buy",
      size: { base: 5n * 10n ** 16n },
      trigger: { price: 1n, direction: "above" },
      worstPrice: 10n ** 12n,
      reason: "Buy XVS at any price",
    },
    signal,
  );
  const filled = async () =>
    (await rig.stores.intents.list({ states: ["paper_filled"], limit: 5 }, { signal })).length > 0;
  await mineUntil(fork, filled, signal);
}

// The latest price the watcher read; none read is a broken rig.
function lastOf(prices: readonly bigint[]): bigint {
  const last = prices.at(-1);
  if (last === undefined) {
    throw new Error("Expected the watcher to have read a price.");
  }
  return last;
}

function resumedNotices(rig: FillRig) {
  return rig.pushes
    .filter(({ topic }) => topic === "notice")
    .map(({ data }) => noticeSchema.parse(data))
    .filter(({ key }) => key === "notice.resumed");
}

describe("the downtime re-check on a BSC fork", () => {
  it("fills after a restart only the orders whose trigger the price now holds, and reports once", async ({
    signal,
  }) =>
    onFillFork(signal, { token: xvs, flags: [] }, async (rig, fork) => {
      const before = new AbortController();
      const first = await watchFor(fork, { rig, engine: rig.engine, stop: before.signal });
      await buyXvs(fork, rig, signal);
      const micros = lastOf(first.prices);
      const ids: Id<"ord">[] = [];
      for (const request of exits(rig, micros)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one card after the other
        ids.push(await confirmedOrder(rig, request, signal));
      }
      await rig.engine.downtime.alive({ signal });
      before.abort();
      await first.running;

      // While the engine is off, the price of XVS rises past the take-profit and the limit sale.
      await pumpXvs(fork);
      const engine = rig.restart();
      const run = await engine.downtime.started({ signal });
      const after = new AbortController();
      const second = await watchFor(fork, { rig, engine, stop: after.signal });
      await mineUntil(fork, async () => second.prices.length > 0, signal);
      const report: DowntimeReport | undefined = await run?.reported;
      after.abort();
      await second.running;

      const outcomes = new Map(report?.orders.map((order) => [order.order, order]));
      expect(second.prices[0]).toBeGreaterThan((micros * 105n) / 100n);
      expect(ids.map((id) => outcomes.get(id))).toMatchObject([
        { kind: "takeProfit", outcome: "filled" },
        { kind: "stopLoss", outcome: "skipped", reason: "trigger_not_met" },
        { kind: "limit", outcome: "skipped", reason: "worst_price" },
      ]);
      expect(resumedNotices(rig)).toMatchObject([
        { values: { cause: "start", checked: "3", filled: "1", skipped: "2" } },
      ]);
    }));
});
