import {
  accountRefSchema,
  type ChainDefinition,
  chainRefSchema,
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
import { describe, expect, it } from "vitest";
import { hostVenues } from "./hosted-venue.js";

const fakeChain: ChainDefinition = createFakeChainDefinition();
const chains = createChainRegistry({
  chains: [fakeChain],
  families: [createFakeFamily()],
  signingSchemes: [createFakeSigningScheme()],
});
const fakeOne = chainRefSchema.parse("fake:1");
const verification = {
  source: "https://example.invalid/launchpads",
  checkedOn: "2026-01-01",
  control: "read",
} as const;

describe("hosted venues", () => {
  it("reads each declared contract's address from the chain registry", () => {
    const hosted = hostVenues([createFakeVenue()], chains);
    expect(hosted.get("fake-swap")?.contracts).toStrictEqual(
      new Map([[fakeOne, { router: "fake:1:0x0000000b" }]]),
    );
  });

  it("keeps the names of the contracts each launch has, by chain", () => {
    const launchpad = createFakeLaunchpad({
      onCurve: [],
      launchCurve: accountRefSchema.parse("fake:1:0x00000010"),
    });
    const registry = createChainRegistry({
      chains: [
        {
          ...fakeChain,
          contracts: [{ venue: "fake-curve", name: "router", address: "0x0000000d", verification }],
        },
      ],
      families: [createFakeFamily()],
      signingSchemes: [createFakeSigningScheme()],
    });
    expect(hostVenues([launchpad], registry).get("fake-curve")?.launchNames).toStrictEqual(
      new Map([[fakeOne, new Set(["curve"])]]),
    );
    expect(hostVenues([createFakeVenue()], chains).get("fake-swap")?.launchNames).toStrictEqual(
      new Map(),
    );
  });

  it.each<[string, Partial<Venue>]>([
    ["a declaration that breaks its schema", { id: "Fake Swap" }],
    [
      "a launch contract named as a registry one",
      { contracts: [{ chain: fakeOne, names: ["router"], launchContracts: ["router"] }] },
    ],
    [
      "a chain the registry does not hold",
      { contracts: [{ chain: chainRefSchema.parse("fake:2"), names: ["router"] }] },
    ],
    [
      "a contract the registry does not list",
      { contracts: [{ chain: fakeOne, names: ["router", "quoter"] }] },
    ],
    ["another venue's contract", { id: "other-swap" }],
  ])("refuses a venue with %s", (_case, change) => {
    expect(() => hostVenues([{ ...createFakeVenue(), ...change }], chains)).toThrow(
      expect.objectContaining({ code: "venue.bad_declaration" }),
    );
  });

  it("refuses two venues with one id", () => {
    expect(() => hostVenues([createFakeVenue(), createFakeVenue()], chains)).toThrow(
      expect.objectContaining({ code: "venue.duplicate_venue" }),
    );
  });
});
