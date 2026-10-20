import {
  accountRefSchema,
  assetRefSchema,
  type ChainDefinition,
  createChainRegistry,
  type CurveHolding,
  type LaunchpadVenue,
  type Venue,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeLaunchpad,
  createFakeLinkLauncher,
  createFakeSigningScheme,
  createFakeVenue,
  fakeLaunchCallAbi,
  fakePriceAnswer,
} from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createVenueHost, type TradeQuote, type VenueHost, type VenueTrade } from "./venue-host.js";

const nowMs = 1_800_000_000_000;
const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const other = assetRefSchema.parse("fake:1/token:0x0000000b");
const curve = accountRefSchema.parse("fake:1:0x00000010");
const stranger = accountRefSchema.parse("fake:1:0x00000011");
const signal = new AbortController().signal;
const fakeChain = createFakeChainDefinition();
const verification = {
  source: "https://example.invalid/launchpads",
  checkedOn: "2026-01-01",
  control: "read",
} as const;
// The registry lists the launchpad's router; its curves are no registry contract.
const chain: ChainDefinition = {
  ...fakeChain,
  contracts: [
    ...fakeChain.contracts,
    { venue: "fake-curve", name: "router", address: "0x0000000d", verification },
  ],
};

function hostOf(venues: readonly Venue[]): VenueHost {
  const chains = createChainRegistry({
    chains: [chain],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
  return createVenueHost({ venues, chains, clock: createManualClock(nowMs), callTimeoutMs: 5_000 });
}

const launchpad = (): LaunchpadVenue =>
  createFakeLaunchpad({ onCurve: [token], launchCurve: curve, noDeadline: true });

// A launchpad whose curve read answers every token with one holding.
function answering(holding: CurveHolding): Venue {
  return { ...launchpad(), curve: async () => await Promise.resolve(holding) };
}

// The value of an answer that succeeded; a test that expects one fails on any other.
function valueOf<T>(answer: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!answer.ok) {
    throw new Error("The host refused.");
  }
  return answer.value;
}

const buy: VenueTrade = {
  venue: "fake-curve",
  wallet,
  amountIn: { asset: coin, base: 1_000_000n },
  assetOut: token,
  maxSlippageBps: bpsSchema.parse(50),
};
const sell: VenueTrade = { ...buy, amountIn: { asset: token, base: 500n }, assetOut: coin };

describe("which venues trade on a launch's own contracts", () => {
  it("names a launchpad that declares launch contracts, and no other venue", () => {
    const host = hostOf([createFakeVenue(), launchpad()]);
    const plain = hostOf([createFakeLaunchpad({ onCurve: [token] })]);
    expect([
      host.hasLaunchContracts("fake-curve"),
      host.hasLaunchContracts("fake-swap"),
      host.hasLaunchContracts("no-such-venue"),
      plain.hasLaunchContracts("fake-curve"),
    ]).toStrictEqual([true, false, false, false]);
  });
});

// A venue with a launcher whose only call is a launch wallet's, and no spender.
const launching = (): Venue => {
  const { curve: _curve, ...pad } = createFakeLaunchpad({
    onCurve: [],
    launcher: createFakeLinkLauncher(),
  });
  const calls = [
    { contract: "router", abi: fakeLaunchCallAbi, walletInputs: [], isLaunchWalletOnly: true },
  ] as const;
  return {
    ...pad,
    contracts: pad.contracts.map(({ chain: on, names }) => ({ chain: on, names, calls })),
  };
};

describe("which venues only launch tokens", () => {
  it("names a venue with a launcher that asks nothing of a main wallet, and no other", () => {
    const host = hostOf([createFakeVenue(), launching()]);
    const trading = hostOf([
      createFakeLaunchpad({ onCurve: [token], launcher: createFakeLinkLauncher() }),
    ]);
    const { launcher: _launcher, ...withoutLauncher } = launching();
    expect([
      host.launchesOnly("fake-curve"),
      host.launchesOnly("fake-swap"),
      host.launchesOnly("no-such-venue"),
      trading.launchesOnly("fake-curve"),
      hostOf([withoutLauncher]).launchesOnly("fake-curve"),
    ]).toStrictEqual([true, false, false, false, false]);
  });
});

describe("a launch's own contracts in the venue host", () => {
  it("names the curve a launchpad's read gives for a token it holds", async () => {
    await expect(hostOf([launchpad()]).curves(token, { signal })).resolves.toStrictEqual({
      ok: true,
      value: [{ launchpad: "fake-curve", quoteAsset: coin, launch: { curve } }],
    });
  });

  it.each([
    [
      "a name it does not declare",
      answering({ onCurve: true, quoteAsset: coin, launch: { pool: curve } }),
    ],
    [
      "a contract of another chain",
      answering({
        onCurve: true,
        quoteAsset: coin,
        launch: { curve: accountRefSchema.parse("fake:2:0x00000010") },
      }),
    ],
    [
      "one with no launch contracts declared",
      {
        ...createFakeLaunchpad({ onCurve: [] }),
        curve: async () =>
          await Promise.resolve({ onCurve: true, quoteAsset: coin, launch: { curve } }),
      },
    ],
  ] as const)("fails the read as venue down for a launch contract with %s", async (_, venue) => {
    await expect(hostOf([venue]).curves(token, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("quotes and builds a buy and a sale through the launch's curve, which every check passes", async () => {
    const host = hostOf([launchpad()]);
    const bought = await host.plan(buy, { signal });
    const sold = await host.plan(sell, { signal });
    expect(bought).toMatchObject({ ok: true, value: { steps: [{ kind: "trade" }] } });
    expect(sold).toMatchObject({
      ok: true,
      value: {
        steps: [
          { kind: "approval", approval: { spender: curve } },
          { kind: "trade", call: { target: curve } },
        ],
      },
    });
    const quoted = await host.quote(buy, { signal });
    expect(quoted).toMatchObject({ ok: true, value: { launch: { curve } } });
  });

  it("refuses a build to a curve its read did not name for the token", async () => {
    const venue = launchpad();
    const elsewhere: Venue = {
      ...venue,
      build: async (request, call) =>
        venue.build({ ...request, contracts: { ...request.contracts, curve: stranger } }, call),
    };
    await expect(hostOf([elsewhere]).plan(buy, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "undeclared_contract",
    });
  });

  it("refuses to build with launch contracts under a name the venue does not declare", async () => {
    const host = hostOf([launchpad()]);
    const quoted = valueOf(await host.quote(buy, { signal }));
    const forged: TradeQuote = { ...quoted, launch: { pool: stranger } };
    await expect(host.build(forged, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("gives a trade of a token the launchpad does not hold no launch contracts", async () => {
    const host = hostOf([launchpad(), createFakeVenue()]);
    await expect(host.quote({ ...buy, assetOut: other }, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it("lets the price read of a held token call its launch's curve", async () => {
    const read = valueOf(await hostOf([launchpad()]).priceRead(token, { signal }));
    expect(read).toMatchObject({
      venue: "fake-curve",
      calls: [{ target: curve, input: `price:${token}` }],
    });
    const price = { numerator: 3n, denominator: 2n };
    expect(read.price([fakePriceAnswer(price)])).toStrictEqual({ ok: true, value: price });
  });
});
