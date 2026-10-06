import {
  accountRefSchema,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
  type Venue,
} from "@binference/chain";
import { createFakeVenue, fakeDraft, fakeSwapData } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { defineVenue } from "./define-venue.js";
import type { BuildRequest, Bps, DecodedEffect } from "./index.js";
import { quoterContract, txBuilderContract, txDecoderContract } from "./testing.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const request: BuildRequest = {
  wallet,
  amountIn: { asset: coin, base: 1_000n },
  assetOut: token,
  contracts: { router },
  quote: { expectedOut: { asset: token, base: 2_000n }, priceImpactBps: 10 as Bps },
  minOut: { asset: token, base: 1_990n },
  deadlineMs: 1_800_000_060_000,
};
const effect: DecodedEffect = {
  recipient: wallet,
  amountIn: request.amountIn,
  minOut: request.minOut,
  deadlineMs: request.deadlineMs,
};
const swap = fakeDraft(wallet, { to: "0x0000000b", value: 1_000n, data: fakeSwapData(effect) });

describe("defineVenue", () => {
  it.each([
    ...quoterContract({
      create: () => ({
        quoter: defineVenue(createFakeVenue()),
        request,
        unroutable: { ...request, assetOut: coin },
      }),
    }),
    ...txBuilderContract({ create: () => ({ builder: defineVenue(createFakeVenue()), request }) }),
    ...txDecoderContract({
      create: () => ({
        decoder: defineVenue(createFakeVenue()),
        draft: swap,
        effect,
        foreign: { ...swap, payload: "x" },
      }),
    }),
  ])("gives a venue that follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("returns a frozen venue that keeps the declaration it was defined with", () => {
    const definition = createFakeVenue();
    const venue = defineVenue(definition);
    expect(Object.isFrozen(venue)).toBe(true);
    expect(Object.isFrozen(venue.contracts)).toBe(true);
    expect(Object.isFrozen(venue.contracts[0]?.names)).toBe(true);
    expect(venue.contracts).toStrictEqual(definition.contracts);
    expect(venue.contracts).not.toBe(definition.contracts);
  });

  it("calls the definition's own methods", () => {
    const definition = {
      ...createFakeVenue(),
      decoded: [] as string[],
      decode(draft: Parameters<Venue["decode"]>[0]) {
        this.decoded.push(draft.payload);
        return createFakeVenue().decode(draft);
      },
    };
    const venue = defineVenue(definition);
    expect(venue.decode(swap)).toStrictEqual({ ok: true, value: effect });
    expect(definition.decoded).toStrictEqual([swap.payload]);
  });

  it.each<[string, Partial<Venue>]>([
    ["an id outside kebab-case", { id: "Fake Swap" }],
    ["no contracts", { contracts: [] }],
    [
      "a chain that is no CAIP-2 id",
      { contracts: [{ chain: "fake" as ChainRef, names: ["router"] }] },
    ],
    [
      "a contract name twice",
      { contracts: [{ chain: chainRefSchema.parse("fake:1"), names: ["router", "router"] }] },
    ],
  ])("refuses a declaration with %s", (_case, change) => {
    expect(() => defineVenue({ ...createFakeVenue(), ...change })).toThrow(
      expect.objectContaining({ code: "plugin.bad_venue" }),
    );
  });
});
