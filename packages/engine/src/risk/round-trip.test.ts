import { accountRefParts, accountRefSchema, type TxSimulator, type Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import { bpsSchema, err, ok } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testAccount, testChains } from "../operations/test-engine.js";
import { createVenueHost } from "../venues/venue-host.js";
import { probeRoundTrip } from "./round-trip.js";
import {
  createTokenModelSimulator,
  type TokenModel,
  unknownToken,
  unknownTokenQuote,
} from "./test-round-trip.js";

const nowMs = 1_800_000_000_000;
const live = new AbortController().signal;

function optionsOf(model: TokenModel, venues: readonly Venue[] = [createFakeVenue()]) {
  const chains = testChains();
  const clock = createManualClock(nowMs);
  const host = createVenueHost({ venues, chains, clock, callTimeoutMs: 5_000 });
  const simulator = createTokenModelSimulator(model);
  return { host, simulator, chains, random: createSeededRandom(11) };
}

// A venue that quotes and builds the buy, but finds no route to sell the token back.
function oneWayVenue(): Venue {
  const venue = createFakeVenue();
  return {
    ...venue,
    quote: async (request, options) =>
      request.amountIn.asset === unknownToken
        ? await Promise.resolve(err("no_route"))
        : await venue.quote(request, options),
  };
}

// A venue that quotes and builds the buy, but whose quote to sell the token back fails.
function downOnSale(): Venue {
  const venue = createFakeVenue();
  return {
    ...venue,
    quote: async (request, options) =>
      request.amountIn.asset === unknownToken
        ? await Promise.reject(new Error("venue down"))
        : await venue.quote(request, options),
  };
}

// A venue that quotes both ways and builds the buy, but cannot build the sale.
function unbuiltSale(): Venue {
  const venue = createFakeVenue();
  return {
    ...venue,
    build: async (request, options) =>
      request.amountIn.asset === unknownToken
        ? await Promise.reject(new Error("venue down"))
        : await venue.build(request, options),
  };
}

// A venue whose own contract takes a tax on each side of the token, as a launchpad's curve does:
// no transfer shows it, so only its quotes name it.
function curveTaxVenue(taxes: { readonly buy: number; readonly sell: number }): Venue {
  const venue = createFakeVenue();
  return {
    ...venue,
    quote: async (request, options) => {
      const quoted = await venue.quote(request, options);
      const isSale = request.amountIn.asset === unknownToken;
      const taxBps = bpsSchema.parse(isSale ? taxes.sell : taxes.buy);
      return quoted.ok ? ok({ ...quoted.value, taxBps }) : quoted;
    },
  };
}

describe("round trip", () => {
  it("measures each leg's tax from two fresh accounts, in three simulations", async () => {
    const options = optionsOf({ buyTaxBps: 300, transferTaxBps: 100, sellTaxBps: 4_000 });
    await expect(probeRoundTrip(unknownTokenQuote(nowMs), options, live)).resolves.toStrictEqual({
      kind: "measured",
      buyTaxBps: 300,
      transferTaxBps: 100,
      sellTaxBps: 4_000,
    });
    expect(options.simulator.runs()).toBe(3);
  });

  it("counts the tax a venue's own contract takes on a leg that its transfers never show", async () => {
    const options = optionsOf({}, [curveTaxVenue({ buy: 300, sell: 500 })]);
    const quoted = unknownTokenQuote(nowMs);
    const taxed = { ...quoted, quote: { ...quoted.quote, taxBps: bpsSchema.parse(300) } };
    await expect(probeRoundTrip(taxed, options, live)).resolves.toStrictEqual({
      kind: "measured",
      buyTaxBps: 300,
      transferTaxBps: 0,
      sellTaxBps: 500,
    });
  });

  it("keeps the measured tax of a leg when it is above the venue's own", async () => {
    const options = optionsOf({ buyTaxBps: 700, sellTaxBps: 900 }, [
      curveTaxVenue({ buy: 300, sell: 500 }),
    ]);
    const quoted = unknownTokenQuote(nowMs);
    const taxed = { ...quoted, quote: { ...quoted.quote, taxBps: bpsSchema.parse(300) } };
    await expect(probeRoundTrip(taxed, options, live)).resolves.toMatchObject({
      buyTaxBps: 700,
      sellTaxBps: 900,
    });
  });

  it("measures no tax for a token that takes none", async () => {
    const options = optionsOf({});
    await expect(probeRoundTrip(unknownTokenQuote(nowMs), options, live)).resolves.toStrictEqual({
      kind: "measured",
      buyTaxBps: 0,
      transferTaxBps: 0,
      sellTaxBps: 0,
    });
  });

  it("buys, sends and sells from accounts that are neither the wallet nor each other", async () => {
    const options = optionsOf({});
    const senders: string[] = [];
    const simulator: TxSimulator = {
      simulate: async (drafts, call) => {
        senders.push(...drafts.map((draft) => accountRefParts(draft.from).address));
        return options.simulator.simulate(drafts, call);
      },
    };
    await probeRoundTrip(unknownTokenQuote(nowMs), { ...options, simulator }, live);
    const fresh = [...new Set(senders)];
    expect(fresh).toHaveLength(2);
    expect(fresh).not.toContain(accountRefParts(testAccount).address);
  });

  it.each<[string, TokenModel, unknown]>([
    ["a transfer that reverts", { blocksTransfers: true }, { kind: "refused", leg: "transfer" }],
    ["a sale that reverts", { blocksSales: true }, { kind: "refused", leg: "sell" }],
    [
      "a transfer that delivers nothing",
      { transferTaxBps: 10_000 },
      { kind: "refused", leg: "transfer" },
    ],
    ["a buy that reverts", { blocksBuys: true }, { kind: "unavailable" }],
    ["a buy that buys nothing", { buyTaxBps: 10_000 }, { kind: "unavailable" }],
  ])("reads %s", async (_case, model, outcome) => {
    const options = optionsOf(model);
    await expect(probeRoundTrip(unknownTokenQuote(nowMs), options, live)).resolves.toStrictEqual(
      outcome,
    );
  });

  it("reads a token no route sells back as a refused sale", async () => {
    const options = optionsOf({}, [oneWayVenue()]);
    await expect(probeRoundTrip(unknownTokenQuote(nowMs), options, live)).resolves.toStrictEqual({
      kind: "refused",
      leg: "sell",
    });
  });

  it.each<[string, Venue]>([
    ["no venue quotes the sale", downOnSale()],
    ["no venue builds the sale", unbuiltSale()],
  ])("cannot run when %s", async (_case, venue) => {
    const options = optionsOf({}, [venue]);
    await expect(probeRoundTrip(unknownTokenQuote(nowMs), options, live)).resolves.toStrictEqual({
      kind: "unavailable",
    });
  });

  it("cannot run for a wallet on a chain the registry does not hold", async () => {
    const options = optionsOf({});
    const quoted = unknownTokenQuote(nowMs);
    const elsewhere = { ...quoted.trade, wallet: accountRefSchema.parse("fake:9:0x0000000c") };
    await expect(
      probeRoundTrip({ ...quoted, trade: elsewhere }, options, live),
    ).resolves.toStrictEqual({ kind: "unavailable" });
    expect(options.simulator.runs()).toBe(0);
  });

  it("cannot run when the trade's venue is not hosted", async () => {
    const options = optionsOf({}, []);
    await expect(probeRoundTrip(unknownTokenQuote(nowMs), options, live)).resolves.toStrictEqual({
      kind: "unavailable",
    });
    expect(options.simulator.runs()).toBe(0);
  });

  it("rejects when the chain cannot simulate", async () => {
    const options = optionsOf({});
    const failing: TxSimulator = {
      simulate: async () => await Promise.reject(new Error("node down")),
    };
    await expect(
      probeRoundTrip(unknownTokenQuote(nowMs), { ...options, simulator: failing }, live),
    ).rejects.toThrow("node down");
  });
});
