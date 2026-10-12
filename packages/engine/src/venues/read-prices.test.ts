import {
  accountRefSchema,
  assetRefSchema,
  type ChainDefinition,
  chainRefSchema,
  createChainRegistry,
  type PriceRead,
  type PriceReadRequest,
  type Venue,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeLaunchpad,
  createFakeSigningScheme,
  createFakeVenue,
  fakePriceAnswer,
} from "@binference/chain/testing";
import { err, ok, type Result } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { HostedPriceRead } from "./read-prices.js";
import { createVenueHost, type VenueHost } from "./venue-host.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const signal = new AbortController().signal;
const fakeChain = createFakeChainDefinition();
const verification = {
  source: "https://example.invalid/launchpads",
  checkedOn: "2026-01-01",
  control: "read",
} as const;
const chain: ChainDefinition = {
  ...fakeChain,
  contracts: [
    ...fakeChain.contracts,
    { venue: "fake-curve", name: "router", address: "0x0000000d", verification },
    { venue: "pools", name: "router", address: "0x0000000e", verification },
    { venue: "late-pools", name: "router", address: "0x0000000c", verification },
  ],
};
const poolRouter = accountRefSchema.parse("fake:1:0x0000000e");
const price = { numerator: 3n, denominator: 2n };

function hostOf(venues: readonly Venue[]): VenueHost {
  const chains = createChainRegistry({
    chains: [chain],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
  return createVenueHost({
    venues,
    chains,
    clock: createManualClock(1_800_000_000_000),
    callTimeoutMs: 5_000,
  });
}

// A venue with pools of its own, whose price read answers what `answer` makes of the request.
function poolVenue(
  answer: (request: PriceReadRequest) => Result<PriceRead, "no_price_read"> | "throw",
  id = "pools",
): Venue {
  return {
    ...createFakeVenue(),
    id,
    contracts: [{ chain: chainRefSchema.parse(chain.id), names: ["router"] }],
    async priceRead(request, options) {
      options.signal.throwIfAborted();
      const answered = answer(request);
      if (answered === "throw") {
        throw new Error("the pools broke");
      }
      return await Promise.resolve(answered);
    },
  };
}

const readFor = (request: PriceReadRequest): PriceRead => ({
  quoteAsset: coin,
  calls: [{ target: request.contracts["router"] ?? poolRouter, input: "pool" }],
  price: () => ok(price),
});

const poolRead = (request: PriceReadRequest): Result<PriceRead, "no_price_read"> =>
  ok(readFor(request));

function readOf(result: Result<HostedPriceRead, string>): HostedPriceRead {
  if (!result.ok) {
    throw new Error(`The host refused: ${result.error}`);
  }
  return result.value;
}

describe("the venue host's price read", () => {
  it("prices a curve token by the launchpad that holds it, and no other venue", async () => {
    const host = hostOf([poolVenue(poolRead), createFakeLaunchpad({ onCurve: [token] })]);
    const read = readOf(await host.priceRead(token, { signal }));
    expect(read.venue).toBe("fake-curve");
    expect(read.quoteAsset).toBe(coin);
    expect(read.price([fakePriceAnswer(price)])).toStrictEqual({ ok: true, value: price });
  });

  it("prices any other token by the first other venue that declares a read for it", async () => {
    const none = poolVenue(() => err("no_price_read"), "late-pools");
    const host = hostOf([none, poolVenue(poolRead), createFakeLaunchpad({ onCurve: [] })]);
    const read = readOf(await host.priceRead(token, { signal }));
    expect(read.venue).toBe("pools");
    expect(read.calls).toStrictEqual([{ target: poolRouter, input: "pool" }]);
    expect(Object.isFrozen(read)).toBe(true);
  });

  it("answers a token no venue prices as no_price_read", async () => {
    await expect(hostOf([createFakeVenue()]).priceRead(token, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "no_price_read",
    });
  });

  it("answers venue_down when a venue failed and none priced the token", async () => {
    const host = hostOf([poolVenue(() => "throw")]);
    await expect(host.priceRead(token, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
    const later = hostOf([poolVenue(() => "throw", "late-pools"), poolVenue(poolRead)]);
    expect(readOf(await later.priceRead(token, { signal })).venue).toBe("pools");
  });

  it("answers venue_down for a launchpad that holds the token and cannot price it", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [token] });
    const mute = {
      ...launchpad,
      priceRead: async () => await Promise.resolve(err("no_price_read")),
    };
    await expect(
      hostOf([poolVenue(poolRead), mute]).priceRead(token, { signal }),
    ).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it.each([
    ["no call", (read: PriceRead) => ({ ...read, calls: [] })],
    [
      "five calls",
      (read: PriceRead) => ({ ...read, calls: Array.from({ length: 5 }, () => read.calls[0]) }),
    ],
    [
      "a call on another chain",
      (read: PriceRead) => ({ ...read, calls: [{ target: "fake:2:0x0000000e", input: "a" }] }),
    ],
    [
      "a call to a contract the venue does not declare",
      (read: PriceRead) => ({ ...read, calls: [{ target: "fake:1:0x0000000a", input: "a" }] }),
    ],
    ["the token as its own quote", (read: PriceRead) => ({ ...read, quoteAsset: token })],
    ["a quote on another chain", (read: PriceRead) => ({ ...read, quoteAsset: "fake:2/slip44:1" })],
    ["no pricing step", (read: PriceRead) => ({ ...read, price: "three" })],
  ])("refuses a read with %s", async (_name, change) => {
    const host = hostOf([
      poolVenue((request) => ok(change(readFor(request)) as unknown as PriceRead)),
    ]);
    await expect(host.priceRead(token, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("answers venue_down when a launchpad cannot say where a token is", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [token] });
    const broken = {
      ...launchpad,
      curve: async () => await Promise.reject(new Error("the portal broke")),
    };
    await expect(
      hostOf([poolVenue(poolRead), broken]).priceRead(token, { signal }),
    ).resolves.toStrictEqual({ ok: false, error: "venue_down" });
  });

  it("guards the venue's pricing step: a throw or a price at or below zero prices nothing", async () => {
    const steps = [
      () => {
        throw new Error("broken");
      },
      () => ok({ numerator: 0n, denominator: 1n }),
      () => ok({ numerator: 1n, denominator: -1n }),
      () => err("unpriced"),
    ];
    const reads = await Promise.all(
      steps.map(async (step) =>
        readOf(
          await hostOf([
            poolVenue((request) => ok({ ...readFor(request), price: step })),
          ]).priceRead(token, { signal }),
        ),
      ),
    );
    expect(reads.map((read) => read.price([]))).toStrictEqual(
      steps.map(() => ({ ok: false, error: "unpriced" })),
    );
  });

  it("hands on a venue's word that its read no longer holds", async () => {
    const host = hostOf([
      poolVenue((request) => ok({ ...readFor(request), price: () => err("replan") })),
    ]);
    const read = readOf(await host.priceRead(token, { signal }));
    expect(read.price([])).toStrictEqual({ ok: false, error: "replan" });
  });
});
