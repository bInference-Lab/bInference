import {
  type ChainDefinition,
  chainRefSchema,
  createChainRegistry,
  type Venue,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
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

describe("hosted venues", () => {
  it("reads each declared contract's address from the chain registry", () => {
    const hosted = hostVenues([createFakeVenue()], chains);
    expect(hosted.get("fake-swap")?.contracts).toStrictEqual(
      new Map([[fakeOne, { router: "fake:1:0x0000000b" }]]),
    );
  });

  it.each<[string, Partial<Venue>]>([
    ["a declaration that breaks its schema", { id: "Fake Swap" }],
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
