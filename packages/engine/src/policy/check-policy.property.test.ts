import type { Amount, AssetRef, QuotedTrade, UsdPrice } from "@binference/chain";
import type { Bps } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { intentKinds } from "../intents/intent-kind.js";
import { policyReasons } from "../intents/intent-reason.js";
import { createPolicyCheck, type PolicyVerdict } from "./check-policy.js";
import type { PastOutflow, PolicyFacts, PolicySubject } from "./policy-rules.js";

const nowMs = 1_800_000_000_000;
const dayMs = 86_400_000;
const coin = "fake:1/slip44:1" as AssetRef;
const assets = [coin, "fake:1/token:a", "fake:1/token:b", "fake:1/token:c"] as AssetRef[];

interface Case {
  readonly subject: PolicySubject;
  readonly facts: PolicyFacts;
  readonly prices: ReadonlyMap<AssetRef, UsdPrice>;
}

interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

const ratio = fc.record({
  numerator: fc.bigInt({ min: 1n, max: 50n }),
  denominator: fc.bigInt({ min: 1n, max: 20n }),
});

// Each asset may lack a price, so some cases test the missing price.
const priceTables: fc.Arbitrary<ReadonlyMap<AssetRef, UsdPrice>> = fc
  .tuple(...assets.map(() => fc.option(ratio, { nil: undefined, freq: 6 })))
  .map(
    (found: readonly (UsdPrice | undefined)[]) =>
      new Map(
        assets.flatMap((asset, index) => {
          const price = found[index];
          return price === undefined ? [] : [[asset, price] as const];
        }),
      ),
  );

// Outflows around the start of the 24-hour window, and some well inside it.
const pastOutflows: fc.Arbitrary<readonly PastOutflow[]> = fc.array(
  fc.record({
    atMs: fc.oneof(
      fc.integer({ min: nowMs - dayMs - 2, max: nowMs - dayMs + 2 }),
      fc.integer({ min: nowMs - 2 * dayMs, max: nowMs }),
    ),
    valueUsdMicros: fc.bigInt({ min: 0n, max: 6_000n }),
  }),
  { maxLength: 4 },
);

const randomCases: fc.Arbitrary<Case> = fc.record({
  subject: fc.record({
    kind: fc.constantFrom(...intentKinds.filter((kind) => kind !== "rescue")),
    isPaper: fc.boolean(),
    hasOutsideContent: fc.boolean(),
    outflows: fc.array(
      fc.record({ asset: fc.constantFrom(...assets), base: fc.bigInt({ min: 0n, max: 200n }) }),
      { maxLength: 3 },
    ),
    inflowAssets: fc.subarray(assets),
  }),
  facts: fc.record({
    isFrozen: fc.boolean(),
    limits: fc.record({
      perTradeCapUsdMicros: fc.bigInt({ min: 0n, max: 12_000n }),
      rollingDayCapUsdMicros: fc.bigInt({ min: 0n, max: 24_000n }),
      maxSlippageBps: fc.constant({ registry: 100 as Bps, other: 500 as Bps }),
      maxTaxBps: fc.constant(1000 as Bps),
      gasReserveBase: fc.bigInt({ min: 0n, max: 200n }),
      venues: fc.constant([]),
      allowTokens: fc.constant([]),
      denyTokens: fc.constant([]),
    }),
    sendLevel: fc.constantFrom(0, 1, 2, 3),
    addressBook: fc.constant([]),
    nativeAsset: fc.constant(coin),
    nativeBalanceBase: fc.bigInt({ min: 0n, max: 600n }),
    ceilingPerTxNativeBase: fc.bigInt({ min: 0n, max: 600n }),
    recentOutflows: pastOutflows,
  }),
  prices: priceTables,
});

// Moves both caps to within two micro-dollars of the exact value, where a rounding slip shows.
function capsNearValue(item: Case, offsets: readonly [bigint, bigint]): Case {
  const { numerator, denominator } = exactValue(item.subject.outflows, item.prices);
  const floor = numerator / denominator;
  const spent = windowSpent(item.facts.recentOutflows);
  const limits = {
    ...item.facts.limits,
    perTradeCapUsdMicros: floor + offsets[0],
    rollingDayCapUsdMicros: spent + floor + offsets[1],
  };
  return { ...item, facts: { ...item.facts, limits } };
}

const offset = fc.bigInt({ min: -2n, max: 2n });

const cases: fc.Arbitrary<Case> = randomCases.chain((item) =>
  fc.oneof(
    fc.constant(item),
    fc
      .tuple(offset, offset)
      .map((offsets: readonly [bigint, bigint]) => capsNearValue(item, offsets)),
  ),
);

async function verdictOf(
  { subject, facts, prices }: Case,
  quote?: QuotedTrade,
): Promise<PolicyVerdict> {
  const policy = createPolicyCheck({
    prices: createFakePriceSource(prices),
    clock: createManualClock(nowMs),
  });
  const signal = new AbortController().signal;
  return policy.check(subject, facts, quote === undefined ? { signal } : { signal, quote });
}

// A trade's own quote between two of the assets, which may price one side from the other.
const quotes: fc.Arbitrary<QuotedTrade> = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom(...assets), { minLength: 2, maxLength: 2 }),
    fc.bigInt({ min: 1n, max: 200n }),
    fc.bigInt({ min: 1n, max: 200n }),
  )
  .map(([pair, inBase, outBase]: readonly [readonly AssetRef[], bigint, bigint]): QuotedTrade => ({
    amountIn: { asset: pair[0] ?? coin, base: inBase },
    expectedOut: { asset: pair[1] ?? coin, base: outBase },
  }));

// The price table with the quote's unpriced side at the price the quote gives it (decision 0059).
function withQuotedPrice(item: Case, quote: QuotedTrade): Case {
  const sides = [
    [quote.amountIn, quote.expectedOut],
    [quote.expectedOut, quote.amountIn],
  ] as const;
  const added = sides.flatMap(([own, other]) => {
    const price = item.prices.get(other.asset);
    return item.prices.has(own.asset) || price === undefined
      ? []
      : [
          [
            own.asset,
            { numerator: other.base * price.numerator, denominator: price.denominator * own.base },
          ] as const,
        ];
  });
  return { ...item, prices: new Map([...item.prices, ...added]) };
}

// The exact worth of the outflows as one fraction, with no rounding at all.
function exactValue(outflows: readonly Amount[], prices: ReadonlyMap<AssetRef, UsdPrice>) {
  return outflows.reduce<Fraction>(
    (sum, outflow) => {
      const price = prices.get(outflow.asset) ?? { numerator: 0n, denominator: 1n };
      return {
        numerator:
          sum.numerator * price.denominator + outflow.base * price.numerator * sum.denominator,
        denominator: sum.denominator * price.denominator,
      };
    },
    { numerator: 0n, denominator: 1n },
  );
}

function windowSpent(outflows: readonly PastOutflow[]): bigint {
  return outflows
    .filter((outflow) => outflow.atMs >= nowMs - dayMs)
    .reduce((sum, outflow) => sum + outflow.valueUsdMicros, 0n);
}

function isPriced(item: Case): boolean {
  return item.subject.outflows.every((outflow) => item.prices.has(outflow.asset));
}

// A pass must hold against the exact value, so no rounding ever opens a cap.
function capViolations(item: Case, verdict: PolicyVerdict): readonly string[] {
  if (!verdict.ok) {
    return [];
  }
  const { numerator, denominator } = exactValue(item.subject.outflows, item.prices);
  const { perTradeCapUsdMicros, rollingDayCapUsdMicros } = item.facts.limits;
  const spent = windowSpent(item.facts.recentOutflows);
  return [
    isPriced(item) ? "" : "passed without a price",
    numerator > perTradeCapUsdMicros * denominator ? "passed over the per-trade cap" : "",
    numerator + spent * denominator > rollingDayCapUsdMicros * denominator
      ? "passed over the 24-hour cap"
      : "",
  ].filter((text) => text !== "");
}

// Each outflow rounds up by less than one micro-dollar, never down.
function figureViolations(item: Case, verdict: PolicyVerdict): readonly string[] {
  const figures = verdict.ok ? verdict.value.figures : verdict.figures;
  if (figures === undefined) {
    return isPriced(item) ? ["priced outflows without figures"] : [];
  }
  const { numerator, denominator } = exactValue(item.subject.outflows, item.prices);
  const slack = BigInt(item.subject.outflows.length);
  const value = figures.valueUsdMicros;
  return [
    value * denominator >= numerator ? "" : "rounded down",
    slack === 0n || (value - slack) * denominator < numerator ? "" : "rounded up too far",
    figures.rollingDaySpentUsdMicros === windowSpent(item.facts.recentOutflows)
      ? ""
      : "summed the window wrong",
  ].filter((text) => text !== "");
}

// A refusal stores its first reason and lists each broken rule once, in spec 6's order.
function shapeViolations(item: Case, verdict: PolicyVerdict): readonly string[] {
  if (verdict.ok) {
    return [];
  }
  const order = verdict.reasons.map((reason) => policyReasons.indexOf(reason));
  return [
    verdict.error === verdict.reasons[0] ? "" : "stored another reason than the first",
    order.every((index, at) => at === 0 || index > (order[at - 1] ?? -1)) ? "" : "out of order",
    verdict.reasons.includes("no_price") === !isPriced(item) ? "" : "no_price is wrong",
  ].filter((text) => text !== "");
}

describe("the policy check with the trade's own quote", () => {
  it("judges an intent exactly as at the prices its quote gives the unpriced side", async () => {
    await fc.assert(
      fc.asyncProperty(cases, quotes, async (item, quote) => {
        const priced = withQuotedPrice(item, quote);
        const verdict = await verdictOf(item, quote);
        expect(verdict).toStrictEqual(await verdictOf(priced));
        expect([
          ...capViolations(priced, verdict),
          ...figureViolations(priced, verdict),
        ]).toStrictEqual([]);
      }),
      { numRuns: 500 },
    );
  });
});

describe("the policy check over random intents", () => {
  it("never passes an intent whose exact USD value breaks a cap", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (item) => {
        expect(capViolations(item, await verdictOf(item))).toStrictEqual([]);
      }),
      { numRuns: 1_000 },
    );
  });

  it("rounds each outflow up by less than a micro-dollar and sums the window exactly", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (item) => {
        expect(figureViolations(item, await verdictOf(item))).toStrictEqual([]);
      }),
      { numRuns: 1_000 },
    );
  });

  it("carries every reason in spec order and stores the first", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (item) => {
        expect(shapeViolations(item, await verdictOf(item))).toStrictEqual([]);
      }),
      { numRuns: 1_000 },
    );
  });
});
