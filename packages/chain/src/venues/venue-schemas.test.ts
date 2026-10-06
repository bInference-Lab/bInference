import { describe, expect, it } from "vitest";
import { txDraftSchema } from "../transaction.js";
import { decodedEffectSchema } from "./decoded-effect.js";
import { venueQuoteSchema } from "./venue-quote.js";
import { type VenueDeclarationWire, venueDeclarationSchema } from "./venue.js";

const coin = "fake:1/slip44:1";
const token = "fake:1/token:0x0000000a";
const declaration: VenueDeclarationWire = {
  id: "fake-swap",
  contracts: [{ chain: "fake:1", names: ["router", "quoter"] }],
};

describe("venue schemas", () => {
  it("decodes a draft, a quote and an effect from JSON and encodes them back", () => {
    const draft = { chain: "fake:1", from: "fake:1:0x0000000c", payload: "0x0000000b|1|swap" };
    const quote = { expectedOut: { asset: token, base: "2" }, priceImpactBps: 10, route: "r" };
    const effect = {
      recipient: "fake:1:0x0000000c",
      amountIn: { asset: coin, base: "1" },
      minOut: { asset: token, base: "1" },
      deadlineMs: 1_800_000_060_000,
    };
    expect(txDraftSchema.encode(txDraftSchema.parse(draft))).toStrictEqual(draft);
    expect(venueQuoteSchema.parse(quote).expectedOut.base).toBe(2n);
    expect(venueQuoteSchema.encode(venueQuoteSchema.parse(quote))).toStrictEqual(quote);
    expect(decodedEffectSchema.parse(effect).minOut.base).toBe(1n);
    expect(decodedEffectSchema.encode(decodedEffectSchema.parse(effect))).toStrictEqual(effect);
  });

  it("accepts a venue's declaration and keeps only the declared fields", () => {
    expect(venueDeclarationSchema.parse({ ...declaration, decode: "anything" })).toStrictEqual(
      declaration,
    );
  });

  it.each<[string, VenueDeclarationWire]>([
    ["an id outside kebab-case", { ...declaration, id: "Fake_Swap" }],
    ["an id over 32 characters", { ...declaration, id: "a".repeat(33) }],
    ["no chain", { ...declaration, contracts: [] }],
    [
      "a chain twice",
      { ...declaration, contracts: [...declaration.contracts, ...declaration.contracts] },
    ],
    [
      "a chain that is no CAIP-2 id",
      { ...declaration, contracts: [{ chain: "fake", names: ["router"] }] },
    ],
    ["a chain with no contract", { ...declaration, contracts: [{ chain: "fake:1", names: [] }] }],
    [
      "a contract named twice",
      { ...declaration, contracts: [{ chain: "fake:1", names: ["router", "router"] }] },
    ],
  ])("refuses a declaration with %s", (_case, wire) => {
    expect(venueDeclarationSchema.safeParse(wire).success).toBe(false);
  });
});
