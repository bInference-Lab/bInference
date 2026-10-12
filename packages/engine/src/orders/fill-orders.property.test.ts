import { createFakeVenue } from "@binference/chain/testing";
import { type Bps, bpsPerWhole, type Ratio } from "@binference/core";
import type { FillSize, OrderRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { requestDocument, quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testLimits, testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import type { OrderRecord } from "./order-record.js";
import {
  activeOrder,
  eightyCents,
  fillIntentsOf,
  fillPrices,
  startFillEngine,
  wholeToken,
} from "./test-fills.js";
import { storedOrder, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const coinHeld = 10n ** 18n;
const coinUsd: Ratio = { numerator: 600n, denominator: 10n ** 12n };
const reserveBase = testLimits.gasReserve[0]?.reserveBase ?? 0n;

/** One generated order, the wallet's paper token, the venue's rate and the deny list. */
interface Case {
  readonly request: OrderRequest;
  readonly tokens: bigint;
  readonly rate: Ratio;
  readonly isDenied: boolean;
  readonly isLive: boolean;
}

const sizes: fc.Arbitrary<FillSize> = fc.oneof(
  fc.bigInt({ min: 1n, max: 3n * wholeToken }).map((base) => ({ base })),
  fc.bigInt({ min: 1n, max: 10n ** 16n }).map((base) => ({ base })),
  fc.integer({ min: 1, max: bpsPerWhole }).map((share) => ({ percentBps: share as Bps })),
  fc.bigInt({ min: 1n, max: 3_000_000n }).map((usdMicros) => ({ usdMicros })),
);

type GeneratedKind = "stopLoss" | "takeProfit" | "limitSell" | "limitBuy";

// The order a generated kind and its bounds make: a stop-loss or take-profit at $0.90, or a limit
// order of either side whose trigger any price meets.
function requestOf(kind: GeneratedKind, bounds: Partial<OrderRequest>): OrderRequest {
  const base = { ...testStopLoss(), ...bounds };
  const always = { price: 1n, direction: "above" } as const;
  if (kind === "limitBuy") {
    return { ...base, kind: "limit", side: "buy", trigger: always };
  }
  return kind === "limitSell"
    ? { ...base, kind: "limit", side: "sell", trigger: always }
    : { ...base, kind, trigger: { price: 900_000n } };
}

const requests: fc.Arbitrary<OrderRequest> = fc
  .record({
    kind: fc.constantFrom<GeneratedKind>("stopLoss", "takeProfit", "limitSell", "limitBuy"),
    bounds: fc.record(
      {
        size: sizes,
        worstPrice: fc.bigInt({ min: 1n, max: 2_000_000n }),
        maxSlippageBps: fc.integer({ min: 0, max: 50 }).map((bps) => bps as Bps),
        maxFills: fc.integer({ min: 1, max: 3 }),
      },
      { requiredKeys: ["size"] },
    ),
  })
  .map(({ kind, bounds }) => requestOf(kind, bounds));

// A flag that holds in one case in six, so most cases reach a fill.
const rarely = fc.oneof(
  { weight: 5, arbitrary: fc.constant(false) },
  { weight: 1, arbitrary: fc.constant(true) },
);

const cases: fc.Arbitrary<Case> = fc.record({
  request: requests,
  tokens: fc.oneof(
    { weight: 1, arbitrary: fc.constant(0n) },
    { weight: 5, arbitrary: fc.bigInt({ min: 1n, max: 2n * wholeToken }) },
  ),
  rate: fc.record({
    numerator: fc.bigInt({ min: 1n, max: 10n ** 13n }),
    denominator: fc.bigInt({ min: 1n, max: 10n ** 4n }),
  }),
  isDenied: rarely,
  isLive: rarely,
});

// The most a fill may spend, worked out apart from the engine, from what the wallet held.
function oracleLimit(request: OrderRequest, held: Case["tokens"]): bigint {
  const { size } = request;
  const isBuy = request.side === "buy";
  const balance = isBuy ? coinHeld - reserveBase : held;
  if ("percentBps" in size) {
    return (balance * BigInt(size.percentBps)) / BigInt(bpsPerWhole);
  }
  const price = isBuy ? coinUsd : eightyCents.usdPerBaseUnit;
  const asked = "base" in size ? size.base : (size.usdMicros * price.denominator) / price.numerator;
  return isBuy || asked < held ? asked : held;
}

// Whether a quote's price at its minimum out stays inside the order's worst price.
function holdsWorst(request: OrderRequest, record: IntentRecord): boolean {
  const { worstPrice } = request;
  if (worstPrice === undefined || record.quote === undefined) {
    return true;
  }
  const quote = quoteDocument.decode(record.quote);
  const isBuy = request.side === "buy";
  const coin = isBuy ? quote.amountIn.base : quote.minOut.base;
  const tokens = isBuy ? quote.minOut.base : quote.amountIn.base;
  const dollars = coin * coinUsd.numerator * wholeToken;
  const atWorst = worstPrice * tokens * coinUsd.denominator;
  return isBuy ? dollars <= atWorst : dollars >= atWorst;
}

// What a filled intent breaks of its order's shape: its kind, token, wallet and mode.
function shapeViolations(order: OrderRecord, record: IntentRecord): readonly string[] {
  const request = requestDocument.decode(record.request);
  const kind = order.request.side === "buy" ? "buy" : "sell";
  const isOwnToken = "token" in request && request.token === order.request.token;
  return [
    request.kind === kind ? "" : `a ${order.request.side} order made a ${request.kind}`,
    isOwnToken ? "" : "another token",
    record.walletId === order.walletId && record.isPaper === order.isPaper ? "" : "another wallet",
    record.isPaper ? "" : "a live fill",
  ];
}

// What a filled intent breaks of its order's bounds and the agent's limits: its size, its worst
// price, the per-trade cap and the deny list (spec 6, invariant 8 for fills; decision 0195).
function boundViolations(item: Case, order: OrderRecord, record: IntentRecord): readonly string[] {
  const spent = record.quote === undefined ? 0n : quoteDocument.decode(record.quote).amountIn.base;
  const isSale = order.request.side === "sell";
  return [
    spent > 0n && spent <= oracleLimit(order.request, item.tokens) ? "" : `spent ${String(spent)}`,
    holdsWorst(order.request, record) ? "" : "past the worst price",
    (record.valueUsdMicros ?? 0n) <= testLimits.perTradeUsdMicros ? "" : "past the per-trade cap",
    isSale && item.isDenied ? "sold a denied token" : "",
  ];
}

function violationsOf(item: Case, order: OrderRecord, record: IntentRecord): readonly string[] {
  return [...shapeViolations(order, record), ...boundViolations(item, order, record)].filter(
    (text) => text !== "",
  );
}

// An order fills at most its maximum, when it has one.
function isWithinFills(order: OrderRecord, fills: number): boolean {
  return order.maxFills === undefined || fills <= order.maxFills;
}

async function engineFor(item: Case): Promise<TestEngine> {
  const limits = { ...testLimits, denyTokens: item.isDenied ? [testToken] : [] };
  return startFillEngine({
    tokens: item.tokens,
    venues: [createFakeVenue({ rate: item.rate })],
    agent: { limits, mode: item.isLive ? "live" : "paper" },
    prices: fillPrices,
  });
}

// Every way a run's fills broke their order, and an order that filled more than it allows.
async function runViolations(item: Case): Promise<readonly string[]> {
  const test = await engineFor(item);
  const order = await activeOrder(test, item.request);
  await Promise.all(
    [1, 2].map(async () => test.engine.fillOrder({ order: order.id, price: eightyCents }, live)),
  );
  await test.clock.advance(3_600_000);
  await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);
  const after = await storedOrder(test, order.id);
  const filled = (await fillIntentsOf(test)).filter(({ state }) => state === "paper_filled");
  const cards = await Promise.all(
    filled.map(async ({ id }) => test.stores.intents.cards(id, live)),
  );
  return [
    ...filled.flatMap((record) => violationsOf(item, order, record)),
    isWithinFills(order, filled.length) ? "" : "too many fills",
    after.fills === filled.length ? "" : "the order's fills differ from its paper fills",
    cards.every((list) => list.length === 0) ? "" : "a fill opened a card",
  ].filter((text) => text !== "");
}

describe("an order's fills, for every order, holding, price and deny list", () => {
  it("never go outside their order's bounds, its mode, its token or the caps", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (item) => {
        expect(await runViolations(item)).toStrictEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("fill a paper stop-loss that holds every bound, so the check is not empty", async () => {
    const item: Case = {
      request: testStopLoss(),
      tokens: wholeToken,
      rate: { numerator: 2n, denominator: 1n },
      isDenied: false,
      isLive: false,
    };
    const test = await engineFor(item);
    const order = await activeOrder(test, item.request);
    await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);
    expect(await fillIntentsOf(test)).toMatchObject([{ state: "paper_filled" }]);
    expect(await runViolations(item)).toStrictEqual([]);
  });
});
