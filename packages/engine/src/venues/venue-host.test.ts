import {
  accountRefSchema,
  assetRefSchema,
  type BuildRequest,
  type ChainDefinition,
  createChainRegistry,
  type DecodedEffect,
  type TxDraft,
  type Venue,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
  createFakeVenue,
  type FakeCall,
  fakeApprovalData,
  fakeDraft,
  fakeSwapData,
} from "@binference/chain/testing";
import { type Bps, err, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { BuildMismatch } from "./build-checks.js";
import {
  createVenueHost,
  type QuoteOutcome,
  type TradePlan,
  type TradeQuote,
  type VenueHost,
  type VenueOutcome,
  type VenueTrade,
} from "./venue-host.js";

const nowMs = 1_800_000_000_000;
const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const stranger = accountRefSchema.parse("fake:1:0x0000000e");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const signal = new AbortController().signal;
const fakeChain = createFakeChainDefinition();
// The registry also lists another venue's router, which the fake venue never declared.
const chain: ChainDefinition = {
  ...fakeChain,
  contracts: [
    ...fakeChain.contracts,
    {
      venue: "other-swap",
      name: "router",
      address: "0x0000000d",
      verification: {
        source: "https://example.invalid/other",
        checkedOn: "2026-01-01",
        control: "read",
      },
    },
  ],
};

// Buys the token with 0.001 of the coin at 2 to 1, allowing 0.5% slippage.
const buy: VenueTrade = {
  venue: "fake-swap",
  wallet,
  amountIn: { asset: coin, base: 1_000_000n },
  assetOut: token,
  maxSlippageBps: 50 as Bps,
};
const sell: VenueTrade = { ...buy, amountIn: { asset: token, base: 500n }, assetOut: coin };
const terms: DecodedEffect = {
  recipient: wallet,
  amountIn: buy.amountIn,
  minOut: { asset: token, base: 1_990_000n },
  deadlineMs: nowMs + 60_000,
};

function hostOf(venue: Venue = createFakeVenue(), clock = createManualClock(nowMs)): VenueHost {
  const chains = createChainRegistry({
    chains: [chain],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
  return createVenueHost({ venues: [venue], chains, clock, callTimeoutMs: 5_000 });
}

// A venue that never answers a quote and ignores its signal.
function silent(): Venue {
  return { ...createFakeVenue(), quote: async () => await new Promise(() => undefined) };
}

// A buy's trade call with some of its terms or its call changed.
function swap(changes: Partial<DecodedEffect> = {}, call: Partial<FakeCall> = {}): TxDraft {
  const data = fakeSwapData({ ...terms, ...changes });
  return fakeDraft(wallet, { to: "0x0000000b", value: 1_000_000n, data, ...call });
}

// The plan of a successful answer, so a test reads it without a conditional.
function planOf(outcome: VenueOutcome): TradePlan {
  if (!outcome.ok) {
    throw new Error(`Expected a plan, got ${outcome.error}.`);
  }
  return outcome.value;
}

// The quote of a successful answer, as `planOf` reads a plan.
function quotedOf(outcome: QuoteOutcome): TradeQuote {
  if (!outcome.ok) {
    throw new Error(`Expected a quote, got ${outcome.error}.`);
  }
  return outcome.value;
}

function building(drafts: readonly TxDraft[]): Venue {
  return { ...createFakeVenue(), build: async () => await Promise.resolve(drafts) };
}

describe("venue host", () => {
  it("plans a buy with the coin as one trade call that keeps every term", async () => {
    const plan = await hostOf().plan(buy, { signal });
    expect(plan).toStrictEqual({
      ok: true,
      value: {
        venue: "fake-swap",
        quote: { expectedOut: { asset: token, base: 2_000_000n }, priceImpactBps: 10 },
        terms: { quotedAtMs: nowMs, minOutBase: 1_990_000n },
        steps: [
          {
            kind: "trade",
            draft: swap(),
            call: { target: accountRefSchema.parse("fake:1:0x0000000b"), nativeValue: 1_000_000n },
            effect: terms,
          },
        ],
      },
    });
  });

  it("quotes a trade without building it, then builds that quote with its own time", async () => {
    const clock = createManualClock(nowMs);
    const builds: BuildRequest[] = [];
    const fake = createFakeVenue();
    const venue: Venue = {
      ...fake,
      async build(request, options) {
        builds.push(request);
        return fake.build(request, options);
      },
    };
    const host = hostOf(venue, clock);
    const quoted = await host.quote(buy, { signal });
    expect(quoted).toStrictEqual({
      ok: true,
      value: {
        trade: buy,
        quote: { expectedOut: { asset: token, base: 2_000_000n }, priceImpactBps: 10 },
        quotedAtMs: nowMs,
      },
    });
    expect(builds).toHaveLength(0);
    await clock.advance(2_000);
    const plan = await host.build(quotedOf(quoted), { signal });
    expect(plan).toStrictEqual(await hostOf().plan(buy, { signal }));
    expect(builds.map((request) => request.deadlineMs)).toStrictEqual([nowMs + 60_000]);
  });

  it("refuses to build a quote for a trade it cannot route", async () => {
    const quote = { expectedOut: { asset: token, base: 2_000_000n }, priceImpactBps: 10 as Bps };
    const elsewhere = { trade: { ...buy, venue: "other-swap" }, quote, quotedAtMs: nowMs };
    await expect(hostOf().build(elsewhere, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
    await expect(hostOf().quote(buy, { signal: AbortSignal.abort() })).rejects.toBeDefined();
    await expect(hostOf().build(elsewhere, { signal: AbortSignal.abort() })).rejects.toBeDefined();
  });

  it("plans a sale of a token as an exact approval and then the trade call", async () => {
    const plan = planOf(await hostOf().plan(sell, { signal }));
    expect(plan.steps.map((step) => step.kind)).toStrictEqual(["approval", "trade"]);
    expect(plan.terms).toStrictEqual({ quotedAtMs: nowMs, minOutBase: 995n });
  });

  it("refuses a venue whose transaction goes to a contract it did not declare", async () => {
    const venue = building([swap({}, { to: "0x0000000d" })]);
    await expect(hostOf(venue).plan(buy, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "undeclared_contract",
    });
  });

  it("refuses a venue whose transaction pays another recipient", async () => {
    const venue = building([swap({ recipient: stranger })]);
    await expect(hostOf(venue).plan(buy, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "other_recipient",
    });
  });

  it("refuses a venue that approves a spender it did not declare", async () => {
    const approval = fakeDraft(wallet, {
      to: "0x0000000a",
      value: 0n,
      data: fakeApprovalData("0x0000000d", 500n),
    });
    const venue = building([
      approval,
      swap({ amountIn: sell.amountIn, minOut: { asset: coin, base: 995n } }, { value: 0n }),
    ]);
    await expect(hostOf(venue).plan(sell, { signal })).resolves.toMatchObject({
      error: "decode_mismatch",
      mismatch: "undeclared_contract",
    });
  });

  it("asks the venue to build with the policy's terms and its registry contracts", async () => {
    const asked: BuildRequest[] = [];
    const fake = createFakeVenue();
    const venue: Venue = {
      ...fake,
      build: async (request, options) => {
        asked.push(request);
        return await fake.build(request, options);
      },
    };
    await hostOf(venue).plan(buy, { signal });
    expect(asked).toStrictEqual([
      {
        wallet,
        amountIn: buy.amountIn,
        assetOut: token,
        contracts: { router: accountRefSchema.parse("fake:1:0x0000000b") },
        quote: { expectedOut: { asset: token, base: 2_000_000n }, priceImpactBps: 10 },
        minOut: terms.minOut,
        deadlineMs: nowMs + 60_000,
      },
    ]);
    expect(Object.isFrozen(asked[0])).toBe(true);
    expect(Object.isFrozen(asked[0]?.minOut)).toBe(true);
  });

  it.each<[string, TxDraft, BuildMismatch]>([
    [
      "spends more than the trade",
      swap({ amountIn: { asset: coin, base: 1_000_001n } }, { value: 1_000_001n }),
      "other_amount",
    ],
    ["sends less coin than it spends", swap({}, { value: 1n }), "other_amount"],
    [
      "accepts less than the policy's minimum",
      swap({ minOut: { asset: token, base: 1_989_999n } }),
      "low_min_out",
    ],
    ["runs past 60 seconds", swap({ deadlineMs: nowMs + 60_001 }), "late_deadline"],
  ])("refuses a trade call that %s", async (_case, draft, mismatch) => {
    await expect(hostOf(building([draft])).plan(buy, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch,
    });
  });

  it.each<[string, readonly TxDraft[]]>([
    ["no draft", []],
    ["a draft its family cannot read", [{ ...swap(), payload: "nonsense" }]],
    ["a trade call its decoder does not know", [swap({}, { data: "swap,short" })]],
    ["something other than drafts", [{ chain: "fake:1" } as TxDraft]],
  ])("refuses %s as unreadable", async (_case, drafts) => {
    await expect(hostOf(building(drafts)).plan(buy, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "unreadable_step",
    });
  });

  it("refuses a step whose decoder throws as unreadable", async () => {
    const venue: Venue = {
      ...createFakeVenue(),
      decode: () => {
        throw new Error("broken");
      },
    };
    await expect(hostOf(venue).plan(buy, { signal })).resolves.toMatchObject({
      mismatch: "unreadable_step",
    });
  });

  it("keeps its own copy of the drafts, so the venue cannot change them after the checks", async () => {
    const draft: { -readonly [K in keyof TxDraft]: TxDraft[K] } = { ...swap() };
    const plan = planOf(await hostOf(building([draft])).plan(buy, { signal }));
    draft.payload = swap({ recipient: stranger }).payload;
    expect(plan.steps[0]?.draft).toStrictEqual(swap());
  });

  it.each<[string, VenueTrade]>([
    ["a pair of one asset", { ...buy, assetOut: coin }],
    ["an asset on another chain", { ...buy, assetOut: assetRefSchema.parse("fake:2/slip44:1") }],
    [
      "a wallet on a chain the venue does not serve",
      { ...buy, wallet: accountRefSchema.parse("fake:2:0x0000000c") },
    ],
  ])("answers %s as no route without asking the venue", async (_case, trade) => {
    const venue = {
      ...createFakeVenue(),
      quote: async () => await Promise.reject(new Error("asked")),
    };
    await expect(hostOf(venue).plan(trade, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it.each<[string, Venue]>([
    [
      "the venue has no route",
      { ...createFakeVenue(), quote: async () => await Promise.resolve(err("no_route")) },
    ],
    ["the venue quotes nothing out", createFakeVenue({ rate: { numerator: 0n, denominator: 1n } })],
  ])("answers no route when %s", async (_case, venue) => {
    await expect(hostOf(venue).plan(buy, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it("refuses a quote that prices another asset", async () => {
    const venue: Venue = {
      ...createFakeVenue(),
      quote: async () =>
        await Promise.resolve(
          ok({ expectedOut: { asset: coin, base: 5n }, priceImpactBps: 1 as Bps }),
        ),
    };
    await expect(hostOf(venue).plan(buy, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "quote_mismatch",
    });
  });

  it.each<[string, Venue, VenueTrade]>([
    ["a venue it does not host", createFakeVenue(), { ...buy, venue: "unknown-swap" }],
    [
      "a quote that throws",
      { ...createFakeVenue(), quote: async () => await Promise.reject(new Error("down")) },
      buy,
    ],
    [
      "a build that throws",
      {
        ...createFakeVenue(),
        build: () => {
          throw new Error("down");
        },
      },
      buy,
    ],
    [
      "a quote outside its type",
      {
        ...createFakeVenue(),
        quote: async () =>
          await Promise.resolve(
            ok({ expectedOut: { asset: token, base: -5n }, priceImpactBps: 10 as Bps }),
          ),
      },
      buy,
    ],
  ])("answers %s as the venue being down", async (_case, venue, trade) => {
    await expect(hostOf(venue).plan(trade, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("answers a venue that never answers as down once the call times out", async () => {
    const clock = createManualClock(nowMs);
    const planned = hostOf(silent(), clock).plan(buy, { signal });
    await clock.advance(4_999);
    const early = await Promise.race([planned, Promise.resolve("waiting")]);
    await clock.advance(1);
    expect(early).toBe("waiting");
    await expect(planned).resolves.toStrictEqual({ ok: false, error: "venue_down" });
  });

  it("rejects with the caller's reason when the caller stops, never blaming the venue", async () => {
    const controller = new AbortController();
    const planned = hostOf(silent()).plan(buy, { signal: controller.signal });
    const reason = new Error("engine stopping");
    controller.abort(reason);
    await expect(planned).rejects.toBe(reason);
    await expect(hostOf().plan(buy, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });
});
