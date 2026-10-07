import type { AccountRef, AssetRef, UsdPrice } from "@binference/chain";
import type { Bps } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createPolicyCheck, type PolicyVerdict } from "./check-policy.js";
import type { PolicyFacts, PolicySubject } from "./policy-rules.js";

const nowMs = 1_800_000_000_000;
const dayMs = 86_400_000;
const coin = "fake:1/slip44:1" as AssetRef;
const usd = "fake:1/token:usd" as AssetRef;
const meme = "fake:1/token:meme" as AssetRef;
const saved = "fake:1:saved" as AccountRef;
const rescue = "fake:1:rescue" as AccountRef;
const stranger = "fake:1:stranger" as AccountRef;
const oneCoin = 10n ** 18n;
// $600 a coin of 18 decimals, and $1 a stablecoin of 6 decimals.
const prices = new Map<AssetRef, UsdPrice>([
  [coin, { numerator: 600_000_000n, denominator: oneCoin }],
  [usd, { numerator: 1n, denominator: 1n }],
]);

const facts: PolicyFacts = {
  isFrozen: false,
  limits: {
    perTradeCapUsdMicros: 100_000_000n,
    rollingDayCapUsdMicros: 500_000_000n,
    maxSlippageBps: { registry: 100 as Bps, other: 500 as Bps },
    maxTaxBps: 1000 as Bps,
    gasReserveBase: 2n * 10n ** 15n,
    venues: ["venue-a", "venue-b"],
    allowTokens: [],
    denyTokens: [],
  },
  sendLevel: 0,
  addressBook: [{ account: saved, isSaved: true, usableAtMs: nowMs - dayMs }],
  rescueAccount: rescue,
  nativeAsset: coin,
  nativeBalanceBase: oneCoin,
  ceilingPerTxNativeBase: oneCoin,
  recentOutflows: [{ atMs: nowMs - 60_000, valueUsdMicros: 400_000_000n }],
};

// A buy of a token for 0.1 coin: $60 on top of $400 spent today.
const buy: PolicySubject = {
  kind: "buy",
  isPaper: false,
  hasOutsideContent: false,
  outflows: [{ asset: coin, base: oneCoin / 10n }],
  inflowAssets: [meme],
  slippage: { bps: 300 as Bps, isRegistryPair: false },
};

// A send of $50 in a stablecoin to a saved address.
const send: PolicySubject = {
  kind: "send",
  isPaper: false,
  hasOutsideContent: false,
  outflows: [{ asset: usd, base: 50_000_000n }],
  inflowAssets: [],
  target: saved,
};

const rescueAll: PolicySubject = {
  kind: "rescue",
  isPaper: false,
  hasOutsideContent: false,
  outflows: [
    { asset: coin, base: oneCoin },
    { asset: meme, base: 5n },
  ],
  inflowAssets: [],
  target: rescue,
};

async function verdict(subject: PolicySubject, changes: Partial<PolicyFacts> = {}) {
  const source = createFakePriceSource(prices);
  const policy = createPolicyCheck({ prices: source, clock: createManualClock(nowMs) });
  const signal = new AbortController().signal;
  return policy.check(subject, { ...facts, ...changes }, { signal });
}

function reasonsOf(result: PolicyVerdict) {
  return result.ok ? [] : result.reasons;
}

function limitsWith(changes: Partial<PolicyFacts["limits"]>): Partial<PolicyFacts> {
  return { limits: { ...facts.limits, ...changes } };
}

function spentAt(atMs: number): Partial<PolicyFacts> {
  return { recentOutflows: [{ atMs, valueUsdMicros: 450_000_000n }] };
}

describe("the policy check", () => {
  it("passes a buy within every limit with the figures the caps read", async () => {
    await expect(verdict(buy)).resolves.toStrictEqual({
      ok: true,
      value: {
        figures: { valueUsdMicros: 60_000_000n, rollingDaySpentUsdMicros: 400_000_000n },
        sellsDeniedToken: false,
      },
    });
  });

  it.each([
    ["frozen", buy, { isFrozen: true }],
    ["paper_only", { ...send, isPaper: true }, {}],
    [
      "per_trade_cap",
      { ...buy, outflows: [{ asset: coin, base: oneCoin / 5n }] },
      { recentOutflows: [] },
    ],
    ["ceiling", buy, { ceilingPerTxNativeBase: oneCoin / 100n }],
    ["daily_cap", buy, { recentOutflows: [{ atMs: nowMs, valueUsdMicros: 450_000_000n }] }],
    ["gas_reserve", buy, { nativeBalanceBase: oneCoin / 10n + 2n * 10n ** 15n - 1n }],
    ["slippage", { ...buy, slippage: { bps: 501 as Bps, isRegistryPair: false } }, {}],
    ["slippage", { ...buy, slippage: { bps: 101 as Bps, isRegistryPair: true } }, {}],
    ["tax", buy, { knownTaxBps: 1001 as Bps }],
    ["venue_off", { ...buy, venue: "venue-z" }, {}],
    ["token_denied", buy, limitsWith({ denyTokens: [meme] })],
    ["token_denied", buy, limitsWith({ allowTokens: [usd] })],
    ["send_level", send, { sendLevel: 3 }],
    ["unsaved_address", { ...send, target: stranger }, {}],
    ["no_price", { ...buy, outflows: [{ asset: meme, base: 1n }] }, {}],
  ] as const)("refuses with %s alone", async (reason, subject, changes) => {
    await expect(verdict(subject, changes)).resolves.toMatchObject({
      ok: false,
      error: reason,
      reasons: [reason],
    });
  });

  it("lists every broken rule in spec order and stores the first", async () => {
    const result = await verdict({ ...buy, venue: "venue-z" }, { isFrozen: true, sendLevel: 3 });
    expect(result).toMatchObject({ ok: false, error: "frozen", reasons: ["frozen", "venue_off"] });
  });

  it("gives the figures behind a cap refusal and none without a price", async () => {
    const overDay = await verdict(buy, {
      recentOutflows: [{ atMs: nowMs, valueUsdMicros: 450_000_000n }],
    });
    expect(overDay).toMatchObject({
      figures: { valueUsdMicros: 60_000_000n, rollingDaySpentUsdMicros: 450_000_000n },
    });
    const unpriced = await verdict({ ...buy, outflows: [{ asset: meme, base: 1n }] });
    expect(unpriced).not.toHaveProperty("figures");
  });
});

describe("the policy check's money math", () => {
  it("rounds a value up to the next micro-dollar against the agent", async () => {
    // A sixth of a coin is a sliver under $100; one base unit more is a sliver over.
    const under = { ...buy, outflows: [{ asset: coin, base: oneCoin / 6n }] };
    const over = { ...buy, outflows: [{ asset: coin, base: oneCoin / 6n + 1n }] };
    const fresh = { recentOutflows: [] };
    await expect(verdict(under, fresh)).resolves.toMatchObject({
      ok: true,
      value: { figures: { valueUsdMicros: 100_000_000n } },
    });
    await expect(verdict(over, fresh)).resolves.toMatchObject({
      ok: false,
      reasons: ["per_trade_cap"],
      figures: { valueUsdMicros: 100_000_001n },
    });
  });

  it("counts an outflow exactly 24 hours old and drops an older one", async () => {
    expect(reasonsOf(await verdict(buy, spentAt(nowMs - dayMs)))).toStrictEqual(["daily_cap"]);
    expect(reasonsOf(await verdict(buy, spentAt(nowMs - dayMs - 1)))).toStrictEqual([]);
  });

  it("treats a zero or malformed price as no price", async () => {
    const zero = createFakePriceSource(new Map([[coin, { numerator: 0n, denominator: 1n }]]));
    const bad = createFakePriceSource(new Map([[coin, { numerator: 1n, denominator: 0n }]]));
    const signal = new AbortController().signal;
    const clock = createManualClock(nowMs);
    const results = await Promise.all(
      [zero, bad].map(async (source) =>
        createPolicyCheck({ prices: source, clock }).check(buy, facts, { signal }),
      ),
    );
    expect(results.map(reasonsOf)).toStrictEqual([["no_price"], ["no_price"]]);
  });

  it("asks once per asset however many outflows share it", async () => {
    const source = createFakePriceSource(prices);
    const policy = createPolicyCheck({ prices: source, clock: createManualClock(nowMs) });
    const twice = {
      ...buy,
      outflows: [buy.outflows[0], buy.outflows[0]].filter((item) => item !== undefined),
    };
    await policy.check(twice, facts, { signal: new AbortController().signal });
    expect(source.asked()).toStrictEqual([coin]);
  });

  it("refuses a negative earlier outflow as a fault", async () => {
    const recentOutflows = [{ atMs: nowMs, valueUsdMicros: -1n }];
    await expect(verdict(buy, { recentOutflows })).rejects.toMatchObject({
      code: "policy.negative_outflow",
    });
  });

  it("stops when its signal aborts", async () => {
    const policy = createPolicyCheck({
      prices: createFakePriceSource(prices),
      clock: createManualClock(nowMs),
    });
    const reason = new Error("stopped");
    await expect(policy.check(buy, facts, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
  });
});

describe("the gas reserve and the ceiling", () => {
  const sell: PolicySubject = {
    ...buy,
    kind: "sell",
    outflows: [{ asset: meme, base: 10n }],
    inflowAssets: [coin],
  };

  it("lets an intent that spends no native coin through below the reserve", async () => {
    const memePrices = new Map([...prices, [meme, { numerator: 1n, denominator: 1n }]]);
    const policy = createPolicyCheck({
      prices: createFakePriceSource(memePrices),
      clock: createManualClock(nowMs),
    });
    const result = await policy.check(
      sell,
      { ...facts, nativeBalanceBase: 1n },
      {
        signal: new AbortController().signal,
      },
    );
    expect(reasonsOf(result)).toStrictEqual([]);
  });

  it("lets a buy spend down to the reserve and not one base unit past it", async () => {
    const exact = oneCoin / 10n + 2n * 10n ** 15n;
    expect(reasonsOf(await verdict(buy, { nativeBalanceBase: exact }))).toStrictEqual([]);
    expect(reasonsOf(await verdict(buy, { nativeBalanceBase: exact - 1n }))).toStrictEqual([
      "gas_reserve",
    ]);
  });

  it("leaves a native send to the address rules, not the ceiling", async () => {
    const coinSend = { ...send, outflows: [{ asset: coin, base: oneCoin / 10n }] };
    const tight = { ceilingPerTxNativeBase: 1n };
    expect(reasonsOf(await verdict(coinSend, tight))).toStrictEqual([]);
    expect(reasonsOf(await verdict({ ...coinSend, kind: "bridge" }, tight))).toStrictEqual([
      "ceiling",
    ]);
  });

  it("never judges the native coin against the token lists", async () => {
    const lists = limitsWith({ allowTokens: [meme], denyTokens: [coin] });
    expect(reasonsOf(await verdict(buy, lists))).toStrictEqual([]);
  });
});

describe("the token lists", () => {
  // A sale of $50 in a stablecoin for the native coin.
  const sale: PolicySubject = {
    ...buy,
    kind: "sell",
    outflows: [{ asset: usd, base: 50_000_000n }],
    inflowAssets: [coin],
  };
  const denyUsd = limitsWith({ denyTokens: [usd] });

  it("passes a sale out of a denied token with the mark for the owner's tap", async () => {
    await expect(verdict(sale, denyUsd)).resolves.toMatchObject({
      ok: true,
      value: { sellsDeniedToken: true },
    });
    await expect(verdict(sale)).resolves.toMatchObject({
      ok: true,
      value: { sellsDeniedToken: false },
    });
  });

  it("marks a send of a denied token the same way", async () => {
    await expect(verdict(send, denyUsd)).resolves.toMatchObject({
      ok: true,
      value: { sellsDeniedToken: true },
    });
  });

  it("refuses a swap into a denied token, whatever leaves the wallet", async () => {
    const swap = { ...sale, kind: "swap", inflowAssets: [meme] } as const;
    const denyMeme = limitsWith({ denyTokens: [meme] });
    expect(reasonsOf(await verdict(swap, denyMeme))).toStrictEqual(["token_denied"]);
    const both = limitsWith({ denyTokens: [usd, meme] });
    expect(reasonsOf(await verdict(swap, both))).toStrictEqual(["token_denied"]);
  });

  it("keeps a set allow list over every token the intent moves, a denied sale included", async () => {
    const allowMemeOnly = limitsWith({ allowTokens: [meme], denyTokens: [usd] });
    expect(reasonsOf(await verdict(sale, allowMemeOnly))).toStrictEqual(["token_denied"]);
    const allowUsd = limitsWith({ allowTokens: [usd], denyTokens: [usd] });
    expect(reasonsOf(await verdict(sale, allowUsd))).toStrictEqual([]);
  });

  it("never marks the native coin, even on the deny list", async () => {
    await expect(verdict(buy, limitsWith({ denyTokens: [coin] }))).resolves.toMatchObject({
      ok: true,
      value: { sellsDeniedToken: false },
    });
  });
});

describe("sends and the send level", () => {
  const cooling = [{ account: saved, isSaved: true, usableAtMs: nowMs + 1 }];

  it("pays a saved address or the rescue address at levels 0 to 2", async () => {
    const outcomes = await Promise.all(
      ([0, 1, 2] as const).flatMap((sendLevel) =>
        [saved, rescue].map(async (target) =>
          reasonsOf(await verdict({ ...send, target }, { sendLevel })),
        ),
      ),
    );
    expect(outcomes.flat()).toStrictEqual([]);
  });

  it("holds a newly saved address until its cooling ends at level 2 only", async () => {
    expect(reasonsOf(await verdict(send, { sendLevel: 2, addressBook: cooling }))).toStrictEqual([
      "send_level",
    ]);
    expect(reasonsOf(await verdict(send, { sendLevel: 1, addressBook: cooling }))).toStrictEqual(
      [],
    );
  });

  it("lets a send pay a saved address at level 2 from the moment its cooling ends", async () => {
    const ended = [{ account: saved, isSaved: true, usableAtMs: nowMs }];
    expect(reasonsOf(await verdict(send, { sendLevel: 2, addressBook: ended }))).toStrictEqual([]);
  });

  it("allows no send at level 3, not even to the rescue address", async () => {
    const result = await verdict({ ...send, target: rescue }, { sendLevel: 3 });
    expect(reasonsOf(result)).toStrictEqual(["send_level"]);
  });

  it("refuses a book entry not saved in the ceiling and a send with no target", async () => {
    const unsaved = [{ account: saved, isSaved: false, usableAtMs: 0 }];
    const { target: _target, ...untargeted } = send;
    expect(reasonsOf(await verdict(send, { addressBook: unsaved }))).toStrictEqual([
      "unsaved_address",
    ]);
    expect(reasonsOf(await verdict(untargeted))).toStrictEqual(["unsaved_address"]);
  });

  it("marks an outside-content send to an address outside the book", async () => {
    const outside = { ...send, hasOutsideContent: true };
    expect(reasonsOf(await verdict({ ...outside, target: stranger }))).toStrictEqual([
      "unsaved_address",
      "outside_content_send",
    ]);
    expect(reasonsOf(await verdict(outside))).toStrictEqual([]);
    expect(reasonsOf(await verdict({ ...outside, target: rescue }))).toStrictEqual([]);
  });
});

describe("a rescue", () => {
  it("passes while frozen, locked, over every cap and without a price, asking no price", async () => {
    const source = createFakePriceSource(prices);
    const policy = createPolicyCheck({ prices: source, clock: createManualClock(nowMs) });
    const result = await policy.check(
      rescueAll,
      { ...facts, isFrozen: true, sendLevel: 3, nativeBalanceBase: 0n, ceilingPerTxNativeBase: 0n },
      { signal: new AbortController().signal },
    );
    expect(result).toStrictEqual({ ok: true, value: { sellsDeniedToken: false } });
    expect(source.asked()).toStrictEqual([]);
  });

  it("pays only the rescue address, in paper mode as well as live", async () => {
    expect(reasonsOf(await verdict({ ...rescueAll, target: saved }))).toStrictEqual([
      "unsaved_address",
    ]);
    const { rescueAccount: _rescueAccount, ...noRescue } = facts;
    const policy = createPolicyCheck({
      prices: createFakePriceSource(prices),
      clock: createManualClock(nowMs),
    });
    const unset = await policy.check(rescueAll, noRescue, { signal: new AbortController().signal });
    expect(reasonsOf(unset)).toStrictEqual(["unsaved_address"]);
    expect(reasonsOf(await verdict({ ...rescueAll, isPaper: true }))).toStrictEqual([]);
  });
});
