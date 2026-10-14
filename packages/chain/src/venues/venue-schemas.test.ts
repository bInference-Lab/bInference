import { describe, expect, it } from "vitest";
import { txDraftSchema } from "../transaction.js";
import { curveHoldingSchema } from "./curve-holding.js";
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

  it("reads the tax a venue's own contract takes in its quote", () => {
    const quote = { expectedOut: { asset: token, base: "2" }, priceImpactBps: 410, taxBps: 300 };
    expect(venueQuoteSchema.parse(quote).taxBps).toBe(300);
    expect(venueQuoteSchema.encode(venueQuoteSchema.parse(quote))).toStrictEqual(quote);
    expect(venueQuoteSchema.safeParse({ ...quote, taxBps: 10_001 }).success).toBe(false);
  });

  it("reads an effect with no deadline as a call that carries none", () => {
    const effect = {
      recipient: "fake:1:0x0000000c",
      amountIn: { asset: coin, base: "1" },
      minOut: { asset: token, base: "1" },
    };
    expect(decodedEffectSchema.parse(effect)).not.toHaveProperty("deadlineMs");
    expect(decodedEffectSchema.encode(decodedEffectSchema.parse(effect))).toStrictEqual(effect);
  });

  it("keeps a chain's declaration that its trade calls carry no deadline", () => {
    const wire: VenueDeclarationWire = {
      ...declaration,
      contracts: [{ chain: "fake:1", names: ["router"], noDeadline: true }],
    };
    expect(venueDeclarationSchema.parse(wire)).toStrictEqual(wire);
  });

  it("accepts a venue's declaration and keeps only the declared fields", () => {
    expect(venueDeclarationSchema.parse({ ...declaration, decode: "anything" })).toStrictEqual(
      declaration,
    );
  });

  it("accepts the calls and spenders of declared contracts, a call with no wallet input", () => {
    const abi = { type: "function", name: "swap", inputs: [] };
    const wire: VenueDeclarationWire = {
      ...declaration,
      contracts: [
        {
          chain: "fake:1",
          names: ["router", "quoter"],
          calls: [{ contract: "router", abi }],
          spenders: ["router"],
        },
      ],
    };
    const [parsed] = venueDeclarationSchema.parse(wire).contracts;
    expect(parsed?.calls).toStrictEqual([{ contract: "router", abi, walletInputs: [] }]);
    expect(parsed?.spenders).toStrictEqual(["router"]);
  });

  it("accepts a launch's own contracts, and calls and spenders on them", () => {
    const abi = { type: "function", name: "buy", inputs: [] };
    const wire: VenueDeclarationWire = {
      ...declaration,
      contracts: [
        {
          chain: "fake:1",
          names: ["factory"],
          launchContracts: ["curve"],
          calls: [{ contract: "curve", abi, walletInputs: [] }],
          spenders: ["curve"],
        },
      ],
    };
    expect(venueDeclarationSchema.parse(wire)).toStrictEqual(wire);
  });

  it("decodes a curve read that names its launch's contracts, and encodes it back", () => {
    const holding = {
      onCurve: true,
      quoteAsset: coin,
      launch: { curve: "fake:1:0x0000000f" },
    } as const;
    const parsed = curveHoldingSchema.parse(holding);
    expect(parsed).toStrictEqual(holding);
    expect(curveHoldingSchema.encode(parsed)).toStrictEqual(holding);
    expect(
      curveHoldingSchema.safeParse({ ...holding, launch: { Curve: "fake:1:0x0000000f" } }).success,
    ).toBe(false);
  });

  it.each<[string, VenueDeclarationWire["contracts"][number]]>([
    [
      "a launch's contract named as a registry one",
      { chain: "fake:1", names: ["router"], launchContracts: ["router"] },
    ],
    [
      "a launch's contract named twice",
      { chain: "fake:1", names: ["router"], launchContracts: ["curve", "curve"] },
    ],
    [
      "a call to no declared contract",
      { chain: "fake:1", names: ["router"], calls: [{ contract: "pool", abi: {} }] },
    ],
    ["a spender no contract declares", { chain: "fake:1", names: ["router"], spenders: ["pool"] }],
    ["a spender twice", { chain: "fake:1", names: ["router"], spenders: ["router", "router"] }],
    [
      "a wallet input twice",
      {
        chain: "fake:1",
        names: ["router"],
        calls: [{ contract: "router", abi: {}, walletInputs: ["to", "to"] }],
      },
    ],
  ])("refuses a declaration with %s", (_case, contracts) => {
    expect(
      venueDeclarationSchema.safeParse({ ...declaration, contracts: [contracts] }).success,
    ).toBe(false);
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
