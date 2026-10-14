import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  type ChainDefinition,
  createChainRegistry,
  type Venue,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeLaunchpad,
  createFakeSigningScheme,
  createFakeVenue,
} from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createVenueHost, type VenueHost } from "./venue-host.js";

const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const insider = accountRefSchema.parse("fake:1:0x000000ee");
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
  ],
};

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

// A launchpad that names every token's insiders as given.
function naming(insiders: readonly AccountRef[]): Venue {
  return {
    ...createFakeLaunchpad({ onCurve: [token] }),
    insiders: async () => await Promise.resolve(insiders),
  };
}

describe("a launchpad's insiders in the venue host", () => {
  it("names the insiders a launchpad reads for a token it launched", async () => {
    const host = hostOf([createFakeLaunchpad({ onCurve: [token], insiders: [insider] })]);
    await expect(host.insiders("fake-curve", token, { signal })).resolves.toStrictEqual({
      ok: true,
      value: [insider],
    });
  });

  it("keeps the first 50 insiders of a launch that favors more", async () => {
    const many = Array.from({ length: 60 }, (_unused, index) =>
      accountRefSchema.parse(`fake:1:0x${(0x100 + index).toString(16).padStart(8, "0")}`),
    );
    const named = await hostOf([naming(many)]).insiders("fake-curve", token, { signal });
    expect(named).toStrictEqual({ ok: true, value: many.slice(0, 50) });
  });

  it("names none for a venue that reads no insiders, or one the host does not hold", async () => {
    const host = hostOf([createFakeVenue()]);
    await expect(host.insiders("fake-swap", token, { signal })).resolves.toStrictEqual({
      ok: true,
      value: [],
    });
    await expect(host.insiders("gone", token, { signal })).resolves.toStrictEqual({
      ok: true,
      value: [],
    });
  });

  it.each([
    [
      "throws",
      {
        ...createFakeLaunchpad({ onCurve: [token] }),
        insiders: async () => await Promise.reject(new Error("rpc down")),
      },
    ],
    ["names an account of another chain", naming([accountRefSchema.parse("fake:2:0x000000ee")])],
    ["names an account twice", naming([insider, insider])],
  ] as const)("answers venue down for a launchpad that %s", async (_case, venue) => {
    await expect(hostOf([venue]).insiders("fake-curve", token, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });
});
