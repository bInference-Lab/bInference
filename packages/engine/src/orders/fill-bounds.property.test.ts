import { type Bps, bpsPerWhole, type Ratio, type Result } from "@binference/core";
import type { FillSize, OrderState } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BoundedOrder,
  checkFill,
  type FillFacts,
  fillLimitBase,
  type FillQuote,
  type SizeFacts,
} from "./fill-bounds.js";
import type { PriceLevel } from "./price-level.js";

const base = fc.bigInt({ min: 0n, max: 2n ** 96n });
const positive = fc.bigInt({ min: 1n, max: 2n ** 64n });
const bps = fc.integer({ min: 0, max: bpsPerWhole }).map((value) => value as Bps);
const states: readonly OrderState[] = [
  "awaiting_confirmation",
  "active",
  "paused",
  "filled",
  "cancelled",
  "expired",
  "ended",
];
const ratios: fc.Arbitrary<Ratio> = fc.record({ numerator: base, denominator: positive });
const levels: fc.Arbitrary<PriceLevel> = fc.record({
  side: fc.constantFrom("atOrAbove" as const, "atOrBelow" as const),
  price: ratios,
});
const nowMs = 1_800_000_000_000;

const orders: fc.Arbitrary<BoundedOrder> = fc.record(
  {
    state: fc.constantFrom(...states),
    fills: fc.integer({ min: 0, max: 6 }),
    maxFills: fc.integer({ min: 1, max: 6 }),
    expiresAtMs: fc.integer({ min: nowMs - 10, max: nowMs + 10 }),
    request: fc.record(
      {
        side: fc.constantFrom("buy" as const, "sell" as const),
        worstPrice: positive,
        maxSlippageBps: bps,
      },
      { requiredKeys: ["side"] },
    ),
  },
  { requiredKeys: ["state", "fills", "expiresAtMs", "request"] },
);

// Orders that can fill, so that most generated fills reach the checks after the order's own.
const fillableOrders: fc.Arbitrary<BoundedOrder> = orders.map((order) => ({
  ...order,
  state: "active",
  fills: 0,
  expiresAtMs: nowMs + 1,
}));

const quotes: fc.Arbitrary<FillQuote> = fc
  .record({ amountInBase: base, expectedOutBase: base, cut: base })
  .map(({ amountInBase, expectedOutBase, cut }) => ({
    amountInBase,
    expectedOutBase,
    minOutBase: expectedOutBase > cut ? expectedOutBase - cut : 0n,
  }));

const factsOf: fc.Arbitrary<FillFacts> = fc.record(
  {
    nowMs: fc.constant(nowMs),
    limitBase: base,
    maxSlippageBps: bps,
    otherUsd: ratios,
    tokenDecimals: fc.integer({ min: 0, max: 30 }),
    confirm: levels,
    saleUsdMicros: base,
  },
  { requiredKeys: ["nowMs", "limitBase", "tokenDecimals"] },
);

// Each bound worked out apart from the module, by cross-multiplying whole numbers.
function oracleCanFill(order: BoundedOrder): boolean {
  const hasFillLeft = order.maxFills === undefined || order.fills < order.maxFills;
  return order.state === "active" && nowMs < order.expiresAtMs && hasFillLeft;
}

function oracleSize(order: BoundedOrder, quote: FillQuote, facts: FillFacts): boolean {
  const most = order.request.maxSlippageBps;
  const asked = facts.maxSlippageBps;
  const isSlippageInside = most === undefined || (asked !== undefined && asked <= most);
  const { saleUsdMicros, otherUsd } = facts;
  const isInsideDollars =
    saleUsdMicros === undefined ||
    (otherUsd !== undefined &&
      quote.expectedOutBase * otherUsd.numerator <= saleUsdMicros * otherUsd.denominator);
  return (
    quote.amountInBase > 0n &&
    quote.amountInBase <= facts.limitBase &&
    isSlippageInside &&
    isInsideDollars
  );
}

// The other side's dollars and the tokens, scaled so that dollars per whole token compare as
// `dollars / tokens`; `undefined` without a price or a token.
function oracleSides(
  side: "buy" | "sell",
  amounts: { readonly inBase: bigint; readonly outBase: bigint },
  facts: FillFacts,
): { readonly dollars: bigint; readonly tokens: bigint } | undefined {
  const { otherUsd } = facts;
  const other = side === "buy" ? amounts.inBase : amounts.outBase;
  const token = side === "buy" ? amounts.outBase : amounts.inBase;
  if (otherUsd === undefined || token === 0n) {
    return undefined;
  }
  const scale = 10n ** BigInt(facts.tokenDecimals);
  return { dollars: other * otherUsd.numerator * scale, tokens: token * otherUsd.denominator };
}

function oracleWorst(order: BoundedOrder, quote: FillQuote, facts: FillFacts): boolean {
  const { worstPrice, side } = order.request;
  if (worstPrice === undefined) {
    return true;
  }
  const sides = oracleSides(side, { inBase: quote.amountInBase, outBase: quote.minOutBase }, facts);
  if (sides === undefined) {
    return false;
  }
  const paid = sides.dollars;
  const atWorst = worstPrice * sides.tokens;
  return side === "buy" ? paid <= atWorst : paid >= atWorst;
}

function oracleConfirm(order: BoundedOrder, quote: FillQuote, facts: FillFacts): boolean {
  const { confirm } = facts;
  if (confirm === undefined) {
    return true;
  }
  const amounts = { inBase: quote.amountInBase, outBase: quote.expectedOutBase };
  const sides = oracleSides(order.request.side, amounts, facts);
  if (sides === undefined) {
    return false;
  }
  const left = sides.dollars * confirm.price.denominator;
  const right = confirm.price.numerator * sides.tokens;
  return confirm.side === "atOrAbove" ? left >= right : left <= right;
}

// A quote and facts whose size bound holds about half the time.
const quoted: fc.Arbitrary<{ readonly quote: FillQuote; readonly facts: FillFacts }> = fc
  .record({ quote: quotes, facts: factsOf, extra: base, isInside: fc.boolean() })
  .map(({ quote, facts, extra, isInside }) => ({
    quote,
    facts: { ...facts, limitBase: isInside ? quote.amountInBase + extra : facts.limitBase },
  }));

// The reason a check names, or `undefined` when it passed.
function errorOf<E extends string>(result: Result<unknown, E>): E | undefined {
  return result.ok ? undefined : result.error;
}

// The value of a result that must have passed.
function valueOf<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error("Expected a value.");
  }
  return result.value;
}

const leastOf = (left: bigint, right: bigint): bigint => (left < right ? left : right);

const priceOf = (facts: SizeFacts): Ratio => facts.spendUsd ?? { numerator: 0n, denominator: 1n };

describe("a fill held to its order's bounds, for every order, quote and price", () => {
  it("passes exactly when every bound holds, and names the first it breaks", () => {
    fc.assert(
      fc.property(fc.oneof(orders, fillableOrders), quoted, (order, { quote, facts }) => {
        const verdicts = [
          ["order_inactive", oracleCanFill(order)],
          ["fill_bounds", oracleSize(order, quote, facts)],
          ["worst_price", oracleWorst(order, quote, facts)],
          ["trigger_unconfirmed", oracleConfirm(order, quote, facts)],
        ] as const;
        const broken = verdicts.find(([, holds]) => !holds)?.[0];
        expect(errorOf(checkFill(order, quote, facts))).toBe(broken);
      }),
      { numRuns: 5_000 },
    );
  });
});

const sizes: fc.Arbitrary<FillSize> = fc.oneof(
  base.map((amount) => ({ base: amount })),
  positive.map((usdMicros) => ({ usdMicros })),
  fc.integer({ min: 1, max: bpsPerWhole }).map((share) => ({ percentBps: share as Bps })),
);

const sizeFacts: fc.Arbitrary<SizeFacts> = fc.record(
  {
    side: fc.constantFrom("buy" as const, "sell" as const),
    heldBase: base,
    keptBase: base,
    spendUsd: fc.record({ numerator: positive, denominator: positive }),
  },
  { requiredKeys: ["side", "heldBase", "keptBase"] },
);

// What a size allows, worked out apart from the module.
function oracleLimit(size: FillSize, facts: SizeFacts): bigint | undefined {
  const sale = facts.side === "sell";
  const kept = sale ? 0n : facts.keptBase;
  const spendable = facts.heldBase > kept ? facts.heldBase - kept : 0n;
  const cap = (amount: bigint): bigint =>
    sale && amount > facts.heldBase ? facts.heldBase : amount;
  if ("base" in size) {
    return cap(size.base);
  }
  if ("percentBps" in size) {
    return (spendable * BigInt(size.percentBps)) / BigInt(bpsPerWhole);
  }
  const { spendUsd } = facts;
  return spendUsd === undefined
    ? undefined
    : cap((size.usdMicros * spendUsd.denominator) / spendUsd.numerator);
}

describe("the most a fill may spend, for every size and balance", () => {
  it("matches the size: never past a share of the spendable balance, the dollars or a sale's holding", () => {
    fc.assert(
      fc.property(sizes, sizeFacts, (size, facts) => {
        const limit = fillLimitBase(size, facts);
        expect(limit.ok).toBe(oracleLimit(size, facts) !== undefined);
        fc.pre(limit.ok);
        expect(valueOf(limit)).toBe(oracleLimit(size, facts));
      }),
      { numRuns: 5_000 },
    );
  });

  it("never spends more dollars than a size in dollars names", () => {
    fc.assert(
      fc.property(positive, sizeFacts, (usdMicros, facts) => {
        const limit = fillLimitBase({ usdMicros }, facts);
        fc.pre(limit.ok);
        const price = priceOf(facts);
        expect(valueOf(limit) * price.numerator).toBeLessThanOrEqual(usdMicros * price.denominator);
      }),
      { numRuns: 2_000 },
    );
  });

  it("never sells more than the wallet holds", () => {
    fc.assert(
      fc.property(sizes, sizeFacts, (size, facts) => {
        const limit = fillLimitBase(size, { ...facts, side: "sell", keptBase: 0n });
        fc.pre(limit.ok);
        expect(valueOf(limit)).toBeLessThanOrEqual(facts.heldBase);
      }),
      { numRuns: 2_000 },
    );
  });

  it("never spends the gas reserve of a buy sized by share", () => {
    fc.assert(
      fc.property(bps, base, base, (share, heldBase, keptBase) => {
        const facts = { side: "buy" as const, heldBase, keptBase };
        const spent = valueOf(fillLimitBase({ percentBps: share }, facts));
        expect(heldBase - spent).toBeGreaterThanOrEqual(leastOf(heldBase, keptBase));
      }),
      { numRuns: 2_000 },
    );
  });
});
