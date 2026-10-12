import {
  assetRefSchema,
  type ChainDefinition,
  createChainRegistry,
  type CurveHolding,
  type Venue,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeLaunchpad,
  createFakeSigningScheme,
  createFakeVenue,
} from "@binference/chain/testing";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createVenueHost, type VenueHost } from "./venue-host.js";

const nowMs = 1_800_000_000_000;
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const usd = assetRefSchema.parse("fake:1/token:0x0000000f");
const elsewhere = assetRefSchema.parse("fake:2/slip44:1");
const signal = new AbortController().signal;
const fakeChain = createFakeChainDefinition();
const verification = {
  source: "https://example.invalid/launchpads",
  checkedOn: "2026-01-01",
  control: "read",
} as const;
// The registry lists a router for each of two launchpads beside the fake venue's.
const chain: ChainDefinition = {
  ...fakeChain,
  contracts: [
    ...fakeChain.contracts,
    { venue: "fake-curve", name: "router", address: "0x0000000d", verification },
    { venue: "other-curve", name: "router", address: "0x0000000e", verification },
  ],
};

function hostOf(
  venues: readonly Venue[],
  clock: ManualClock = createManualClock(nowMs),
): VenueHost {
  const chains = createChainRegistry({
    chains: [chain],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
  return createVenueHost({ venues, chains, clock, callTimeoutMs: 5_000 });
}

// A launchpad that answers every token with one holding, or never answers at all.
function answering(holding: CurveHolding | "never"): Venue {
  const launchpad = createFakeLaunchpad({ onCurve: [] });
  return {
    ...launchpad,
    curve: async () =>
      holding === "never" ? await new Promise(() => undefined) : await Promise.resolve(holding),
  };
}

describe("the venue host's curve read", () => {
  it("names the launchpad that holds a token, with what its curve trades it against", async () => {
    const host = hostOf([createFakeVenue(), createFakeLaunchpad({ onCurve: [token] })]);
    await expect(host.curves(token, { signal })).resolves.toStrictEqual({
      ok: true,
      value: [{ launchpad: "fake-curve", quoteAsset: coin }],
    });
  });

  it("answers no claim when no launchpad holds the token", async () => {
    const graduated = createFakeLaunchpad({ onCurve: [token], quoteAsset: usd });
    graduated.graduate(token);
    await expect(
      hostOf([createFakeVenue(), graduated]).curves(token, { signal }),
    ).resolves.toStrictEqual({ ok: true, value: [] });
    await expect(hostOf([createFakeVenue()]).curves(token, { signal })).resolves.toStrictEqual({
      ok: true,
      value: [],
    });
  });

  it("names every launchpad that claims one token", async () => {
    const host = hostOf([
      createFakeLaunchpad({ onCurve: [token] }),
      createFakeLaunchpad({ id: "other-curve", onCurve: [token], quoteAsset: usd }),
    ]);
    await expect(host.curves(token, { signal })).resolves.toStrictEqual({
      ok: true,
      value: [
        { launchpad: "fake-curve", quoteAsset: coin },
        { launchpad: "other-curve", quoteAsset: usd },
      ],
    });
  });

  it.each([
    [
      "throws",
      {
        ...createFakeLaunchpad({ onCurve: [] }),
        curve: async () => await Promise.reject(new Error("rpc down")),
      },
    ],
    ["answers outside its types", answering({ onCurve: true } as unknown as CurveHolding)],
    ["names a quote asset of another chain", answering({ onCurve: true, quoteAsset: elsewhere })],
    ["names the token itself as its quote asset", answering({ onCurve: true, quoteAsset: token })],
  ] as const)("fails the read as venue down when a launchpad %s", async (_name, launchpad) => {
    const host = hostOf([
      createFakeVenue(),
      createFakeLaunchpad({ id: "other-curve", onCurve: [] }),
      launchpad,
    ]);
    await expect(host.curves(token, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("fails the read as venue down once a launchpad that never answers times out", async () => {
    const clock = createManualClock(nowMs);
    const read = hostOf([answering("never")], clock).curves(token, { signal });
    await clock.advance(4_999);
    const early = await Promise.race([read, Promise.resolve("waiting")]);
    await clock.advance(1);
    expect(early).toBe("waiting");
    await expect(read).resolves.toStrictEqual({ ok: false, error: "venue_down" });
  });

  it("rejects with the caller's reason when the caller stops", async () => {
    const reason = new Error("engine stopping");
    const host = hostOf([answering("never")]);
    await expect(host.curves(token, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    const controller = new AbortController();
    const read = host.curves(token, { signal: controller.signal });
    controller.abort(reason);
    await expect(read).rejects.toBe(reason);
  });

  it("tells a launchpad from any other venue", () => {
    const host = hostOf([createFakeVenue(), createFakeLaunchpad({ onCurve: [] })]);
    expect([
      host.isLaunchpad("fake-curve"),
      host.isLaunchpad("fake-swap"),
      host.isLaunchpad("gone"),
    ]).toStrictEqual([true, false, false]);
  });
});
