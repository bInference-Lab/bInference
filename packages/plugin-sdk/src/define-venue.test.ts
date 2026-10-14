import {
  accountRefSchema,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
  type PriceReader,
  type Venue,
} from "@binference/chain";
import {
  createFakeLaunchpad,
  createFakeVenue,
  fakeDraft,
  fakePriceAnswer,
  fakeSwapData,
} from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { defineLaunchpad, defineVenue } from "./define-venue.js";
import type { BuildRequest, Bps, DecodedEffect } from "./index.js";
import {
  curveReaderContract,
  priceReaderContract,
  quoterContract,
  txBuilderContract,
  txDecoderContract,
} from "./testing.js";

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

// The price reads a defined venue keeps, which the suite reads through the venue.
function readerOf(venue: Venue): PriceReader {
  const read = venue.priceRead?.bind(venue);
  if (read === undefined) {
    throw new Error("The defined venue dropped its price reads.");
  }
  return { priceRead: read };
}

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

  it("keeps the calls and spenders a chain declares, frozen", () => {
    const definition = createFakeVenue();
    const call = { contract: "router", abi: { type: "function", name: "swap" }, walletInputs: [] };
    const contracts = definition.contracts.map((item) => ({
      ...item,
      calls: [call],
      spenders: ["router"],
    }));
    const venue = defineVenue({ ...definition, contracts });
    const [declared] = venue.contracts;

    expect(declared?.calls).toStrictEqual([call]);
    expect(declared?.spenders).toStrictEqual(["router"]);
    expect(Object.isFrozen(declared?.calls?.[0]?.walletInputs)).toBe(true);
    expect(Object.isFrozen(declared?.spenders)).toBe(true);
  });

  it("keeps a chain's declaration that its trade calls carry no deadline", () => {
    const venue = defineVenue(createFakeVenue({ noDeadline: true }));
    expect(venue.contracts).toStrictEqual([
      { chain: "fake:1", names: ["router"], noDeadline: true },
    ]);
  });

  it("keeps a launchpad's read of its insiders, called on the definition", async () => {
    const insider = accountRefSchema.parse("fake:1:0x000000ee");
    const launchpad = defineLaunchpad(
      createFakeLaunchpad({ onCurve: [token], insiders: [insider] }),
    );
    await expect(
      launchpad.insiders?.(
        { token, contracts: { router } },
        { signal: new AbortController().signal },
      ),
    ).resolves.toStrictEqual([insider]);
    expect(defineVenue(createFakeVenue()).insiders).toBeUndefined();
  });

  it("keeps the contracts a chain declares each launch has, frozen", () => {
    const curve = accountRefSchema.parse("fake:1:0x00000010");
    const launchpad = defineLaunchpad(
      createFakeLaunchpad({ onCurve: [token], launchCurve: curve }),
    );
    const [declared] = launchpad.contracts;
    expect(declared?.launchContracts).toStrictEqual(["curve"]);
    expect(Object.isFrozen(declared?.launchContracts)).toBe(true);
  });

  it.each(
    curveReaderContract({
      create: () => ({
        reader: defineLaunchpad(createFakeLaunchpad({ onCurve: [token] })),
        onCurve: { token, contracts: { router } },
        offCurve: { token: assetRefSchema.parse("fake:1/token:0x0000000e"), contracts: { router } },
      }),
    }),
  )("gives a launchpad that follows the curve reader contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    priceReaderContract({
      create: () => ({
        reader: readerOf(defineLaunchpad(createFakeLaunchpad({ onCurve: [token] }))),
        priced: { token, contracts: { router } },
        answers: [fakePriceAnswer({ numerator: 1n, denominator: 3n })],
        unpriced: { token: coin, contracts: { router } },
      }),
    }),
  )("gives a venue that keeps its price reads: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("gives a venue that declares no price reads none", () => {
    expect(defineVenue(createFakeVenue()).priceRead).toBeUndefined();
  });

  it("gives a frozen launchpad that reads its curve through the definition", async () => {
    const definition = createFakeLaunchpad({ onCurve: [token] });
    const launchpad = defineLaunchpad(definition);
    definition.graduate(token);
    expect(Object.isFrozen(launchpad)).toBe(true);
    await expect(
      launchpad.curve({ token, contracts: { router } }, { signal: new AbortController().signal }),
    ).resolves.toStrictEqual({ onCurve: false });
  });

  it("refuses a launchpad whose declaration is wrong", () => {
    const definition = { ...createFakeLaunchpad({ onCurve: [token] }), id: "Fake Pad" };
    expect(() => defineLaunchpad(definition)).toThrow(
      expect.objectContaining({ code: "plugin.bad_venue" }),
    );
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
