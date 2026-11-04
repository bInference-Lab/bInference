import { type AssetRef, assetRefSchema, type UsdPrice } from "@binference/chain";
import { createIdSource, type Id, type JsonValue } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testSnapshot } from "../approval/test-snapshot.js";
import type { ExecutorBench } from "../executor/test-executor.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { testCoin, testToken, testWallet } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import type { PositionRecord } from "../positions/position-record.js";
import { copyStateDocument, takenState } from "./copy-state.js";
import { type LandedFillParts, type LandedTrade, landedFillWrite } from "./fill-landed.js";
import type { OrderRecord } from "./order-record.js";
import { copyStateNow, testLeaderTx } from "./test-copies.js";
import { fillPrices } from "./test-fills.js";
import { activeOrderOf, fillOnce, liveFillsOf, startLiveFills } from "./test-live-fills.js";
import { testCopy, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
// A sale of 300 units of the test token for a little of the coin.
const sale: LandedTrade = {
  amountIn: { asset: testToken, base: 300n },
  amountOut: { asset: testCoin, base: 1n },
};

interface Landing {
  readonly bench: ExecutorBench;
  readonly snapshot: IntentSnapshot;
}

// A live limit buy's fill, kept as the snapshot each landed write is held to.
async function landing(): Promise<Landing> {
  const bench = await startLiveFills({ hold: true });
  const buy = await activeOrderOf(bench);
  await fillOnce(bench, buy.id);
  const [fill] = await liveFillsOf(bench);
  return { bench, snapshot: await testSnapshot(bench.test, fill?.id as Id<"int">) };
}

// The live positions holding `quantityBase` of the test token in the test wallet.
function holding(quantityBase: bigint): LandedFillParts["positions"] {
  const position: PositionRecord = {
    walletId: testWallet,
    asset: testToken,
    isPaper: false,
    quantityBase,
    costUsdMicros: 0n,
    realizedUsdMicros: 0n,
    changedAtMs: 0,
    version: 0,
  };
  return { positions: async () => [position] };
}

function partsOf(
  { bench }: Landing,
  changes: {
    readonly positions?: LandedFillParts["positions"];
    readonly prices?: ReadonlyMap<AssetRef, UsdPrice>;
    readonly intents?: Pick<IntentStore, "get">;
  } = {},
): LandedFillParts {
  return {
    orders: bench.test.stores.orders,
    intents: changes.intents ?? bench.test.stores.intents,
    positions: changes.positions ?? holding(0n),
    prices: createFakePriceSource(changes.prices ?? fillPrices),
    chains: testChains(),
    ids: createIdSource({ clock: bench.test.clock, random: createSeededRandom(4) }),
  };
}

async function write(
  at: Landing,
  call: {
    readonly order: OrderRecord;
    readonly settled?: LandedTrade;
    readonly isBooked?: boolean;
    readonly parts?: LandedFillParts;
  },
) {
  const { order, settled = sale, isBooked = true, parts = partsOf(at) } = call;
  const landed = { order, snapshot: at.snapshot, settled, isBooked, atMs: 1, signal: live.signal };
  return landedFillWrite(parts, landed);
}

function keysOf(notices: readonly JsonValue[] | undefined): readonly string[] {
  return (notices ?? []).map((notice) =>
    JSON.stringify(notice).replace(/^.*?"key":"([^"]+)".*$/, "$1"),
  );
}

describe("a landed live fill's write on its order", () => {
  it("ends the position's other exit orders when a booked sale left none of the token", async () => {
    const at = await landing();
    const stop = await activeOrderOf(at.bench, testStopLoss());
    const profit = await activeOrderOf(at.bench, {
      ...testStopLoss(),
      kind: "takeProfit",
      trigger: { price: 2_000_000n },
    });

    const written = await write(at, { order: stop });

    expect(written?.moves).toMatchObject([
      { id: stop.id, state: "filled", fills: 1 },
      { id: profit.id, state: "ended", endReason: "position_closed" },
    ]);
    expect(keysOf(written?.fill.notices)).toStrictEqual(["notice.fill", "notice.ordersEnded"]);
  });

  it("counts a sale not yet booked as emptying a position that held no more than it sold", async () => {
    const at = await landing();
    const stop = await activeOrderOf(at.bench, testStopLoss({ maxFills: 2 }));

    const all = await write(at, {
      order: stop,
      isBooked: false,
      parts: partsOf(at, { positions: holding(300n) }),
    });
    const some = await write(at, {
      order: stop,
      isBooked: false,
      parts: partsOf(at, { positions: holding(301n) }),
    });

    expect(all?.moves).toMatchObject([{ state: "ended", endReason: "position_closed" }]);
    expect(some?.moves).toMatchObject([{ state: "active", fills: 1 }]);
  });

  it("leaves the exit orders of a sale of another token, or of a buy, in place", async () => {
    const at = await landing();
    const stop = await activeOrderOf(at.bench, testStopLoss({ maxFills: 2 }));
    const other = { ...sale, amountIn: { asset: testCoin, base: 300n } };

    const written = await write(at, { order: stop, settled: other });

    expect(written?.moves).toMatchObject([{ id: stop.id, state: "active", fills: 1 }]);
  });

  it("tells the fill of a token the registry lacks by the decimals its card stored", async () => {
    const at = await landing();
    const stop = await activeOrderOf(at.bench, testStopLoss({ token: unlisted, maxFills: 2 }));
    const settled = { ...sale, amountIn: { asset: unlisted, base: 300n } };
    const noCard: Pick<IntentStore, "get"> = { get: async () => undefined };

    const prices = new Map(fillPrices).set(unlisted, { numerator: 1n, denominator: 1n });

    const told = await write(at, { order: stop, settled, parts: partsOf(at, { prices }) });
    const untold = await write(at, {
      order: stop,
      settled,
      parts: partsOf(at, { prices, intents: noCard }),
    });

    expect(keysOf(told?.fill.notices)).toStrictEqual(["notice.fill"]);
    expect(untold?.fill).not.toHaveProperty("notices");
  });

  it("tells no fill whose sold asset nothing prices, and still counts it", async () => {
    const at = await landing();
    const stop = await activeOrderOf(at.bench, testStopLoss({ maxFills: 2 }));
    const parts = partsOf(at, { prices: new Map(), positions: holding(1_000n) });

    const written = await write(at, { order: stop, parts });

    expect(written?.moves).toMatchObject([{ state: "active", fills: 1 }]);
    expect(written?.fill).not.toHaveProperty("notices");
  });

  it("tells a copy order's fill by the decimals its taken trade's token answered", async () => {
    const at = await landing();
    const copy = await activeOrderOf(at.bench, testCopy());
    const facts = { symbol: "UNL", name: "Unlisted", decimals: 9, verified: false };
    const taking = {
      id: 1,
      txHash: testLeaderTx,
      side: "buy" as const,
      asset: unlisted,
      atMs: 0,
      facts,
    };
    const state = await copyStateNow(at.bench.test, copy.id);
    const triggerState = copyStateDocument.encode(takenState(state, taking));
    const bought = {
      amountIn: { asset: testCoin, base: 1n },
      amountOut: { asset: unlisted, base: 9n },
    };

    const written = await write(at, { order: { ...copy, triggerState }, settled: bought });

    expect(keysOf(written?.fill.notices)).toStrictEqual(["notice.fill"]);
  });
});
