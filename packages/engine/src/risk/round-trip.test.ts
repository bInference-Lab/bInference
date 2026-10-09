import { accountRefParts, type TxSimulator, type Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import { err } from "@binference/core";
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
