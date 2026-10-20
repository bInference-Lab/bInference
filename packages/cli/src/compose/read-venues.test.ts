import { chainRefSchema } from "@binference/chain";
import { BinferenceError, bpsSchema, createSecret, type Http } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createScriptedHttp,
  createSeededRandom,
} from "@binference/core/testing";
import { createVenueHost } from "@binference/engine";
import {
  answer,
  bnb,
  buyRoutesUrl,
  hookedRoute,
  recordedWallet,
  scriptedApi,
  usdt,
} from "@binference/kyberswap/testing";
import { describe, expect, it } from "vitest";
import type { VenuesConfig } from "../config/schema/chains-venues.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains, selfHostedPoolHooks } from "./open-engine-parts.js";
import { readVenues } from "./read-venues.js";

const bsc = chainRefSchema.parse("eip155:56");
const random = createSeededRandom(271);

// Secrets by environment variable name; a name with no value is unavailable.
const secrets: SecretReader = {
  async read(path, source) {
    const name = "fromEnv" in source ? source.fromEnv : "";
    if (!name.startsWith("OKX_")) {
      throw new BinferenceError({ code: "config.secret_unavailable", message: `No ${path}.` });
    }
    return Promise.resolve(createSecret(`${name.toLowerCase()}-value`));
  },
};

function venuesWith(okx?: string): VenuesConfig {
  return {
    kyberClientId: "binference",
    keys:
      okx === undefined
        ? {}
        : {
            okx: {
              apiKey: { fromEnv: `${okx}_KEY` },
              secret: { fromEnv: `${okx}_SECRET` },
              passphrase: { fromEnv: `${okx}_PASSPHRASE` },
            },
          },
  };
}

async function read(venues: VenuesConfig) {
  const logger = createMemoryLogger({ subsystem: "engine" });
  const http = createScriptedHttp([]);
  const clock = createManualClock();
  const chains = { enabled: [bsc], rpc: {}, relays: {}, maxFeePerGasGwei: { [bsc]: "1" } };
  const venuesRead = await readVenues({
    random,
    venues,
    chains,
    registry: selfHostedChains(),
    poolHooks: selfHostedPoolHooks(),
    reads: composeChainReads({ chains: selfHostedChains(), config: chains, http, clock }),
    secrets,
    http,
    clock,
    logger,
    signal: new AbortController().signal,
  });
  return { ids: venuesRead.venues.map((venue) => venue.id), logger };
}

describe("the self-hosted venues", () => {
  it("read Flap's curves on each chain through that chain's one RPC failover", async () => {
    const http = createScriptedHttp([]);
    const clock = createManualClock();
    const chains = { enabled: [bsc], rpc: {}, relays: {}, maxFeePerGasGwei: { [bsc]: "1" } };
    const reads = composeChainReads({ chains: selfHostedChains(), config: chains, http, clock });
    const { venues } = await readVenues({
      random,
      venues: venuesWith(),
      chains,
      registry: selfHostedChains(),
      poolHooks: selfHostedPoolHooks(),
      reads,
      secrets,
      http,
      clock,
      logger: createMemoryLogger({ subsystem: "engine" }),
      signal: new AbortController().signal,
    });
    const flap = venues.find((venue) => venue.id === "flap");
    expect(flap?.curve).toBeTypeOf("function");
    expect(flap?.contracts).toMatchObject([{ chain: bsc, names: ["portal"], noDeadline: true }]);
    // It launches tax tokens on BSC, whose registry lists Flap's Tax Token V3 implementation.
    expect(flap?.launcher?.noFirstBuyMin).toBe(true);
  });

  it("quote through KyberSwap and the flap and geniusfun launchpads when config names no OKX key", async () => {
    const { ids, logger } = await read(venuesWith());
    expect(ids).toStrictEqual(["kyberswap", "flap", "geniusfun"]);
    expect(logger.records()).toStrictEqual([]);
  });

  it("add OKX when config names the owner's OKX key", async () => {
    await expect(read(venuesWith("OKX"))).resolves.toMatchObject({
      ids: ["kyberswap", "flap", "geniusfun", "okx"],
    });
  });

  it("leave OKX out, and say so, when its key cannot be read", async () => {
    const { ids, logger } = await read(venuesWith("MISSING"));
    expect(ids).toStrictEqual(["kyberswap", "flap", "geniusfun"]);
    expect(logger.records().map((record) => record.event)).toStrictEqual(["engine.venue_skipped"]);
  });

  it("route KyberSwap through the registry's launchpad pool hooks, and name the fee they keep", async () => {
    const geniusHook = "0x8e6f8ebbd62b60085b703c40b460dae802edc51b";
    const hooked = hookedRoute.replaceAll("0x44428c6ce391915d51f963c0dd395cd0f95fdfd2", geniusHook);
    const http = scriptedApi({ [buyRoutesUrl]: answer(hooked) });
    const clock = createManualClock();
    const chains = { enabled: [bsc], rpc: {}, relays: {}, maxFeePerGasGwei: { [bsc]: "1" } };
    const { venues } = await readVenues({
      random,
      venues: venuesWith(),
      chains,
      registry: selfHostedChains(),
      poolHooks: selfHostedPoolHooks(),
      reads: composeChainReads({ chains: selfHostedChains(), config: chains, http, clock }),
      secrets,
      http,
      clock,
      logger: createMemoryLogger({ subsystem: "engine" }),
      signal: new AbortController().signal,
    });
    const host = createVenueHost({
      venues,
      chains: selfHostedChains(),
      clock,
      callTimeoutMs: 5_000,
    });
    const trade = {
      venue: "kyberswap",
      wallet: recordedWallet,
      amountIn: { asset: bnb, base: 10n ** 17n },
      assetOut: usdt,
      maxSlippageBps: bpsSchema.parse(100),
    };
    await expect(
      host.quote(trade, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        quote: {
          hookFees: [
            {
              maker: "Genius.fun",
              feeBps: 200,
              hooks: ["eip155:56:0x8E6f8eBbD62B60085B703C40B460daE802eDC51b"],
            },
          ],
        },
      },
    });
  });

  it("refuse a pool hook the registry does not list", async () => {
    const http = createScriptedHttp([]);
    const clock = createManualClock();
    const chains = { enabled: [bsc], rpc: {}, relays: {}, maxFeePerGasGwei: { [bsc]: "1" } };
    const reading = readVenues({
      random,
      venues: venuesWith(),
      chains,
      registry: selfHostedChains(),
      poolHooks: new Map([
        [bsc, [{ venue: "geniusfun", contract: "hook-m9", feeBps: 200, maker: "Genius.fun" }]],
      ]),
      reads: composeChainReads({ chains: selfHostedChains(), config: chains, http, clock }),
      secrets,
      http,
      clock,
      logger: createMemoryLogger({ subsystem: "engine" }),
      signal: new AbortController().signal,
    });
    await expect(reading).rejects.toMatchObject({ code: "cli.hook_missing" });
  });

  it("sign the next okx request with the key a reload names, and none once it names none", async () => {
    const sent: (string | undefined)[] = [];
    const http: Http = {
      request: async (request) => {
        sent.push(request.headers?.["OK-ACCESS-KEY"]);
        return Promise.resolve({ status: 503, headers: {}, body: "" });
      },
    };
    const clock = createManualClock();
    const chains = { enabled: [bsc], rpc: {}, relays: {}, maxFeePerGasGwei: { [bsc]: "1" } };
    const held = { venues: venuesWith("OKX") };
    const logger = createMemoryLogger({ subsystem: "engine" });
    const signal = new AbortController().signal;
    const followed = await readVenues({
      random,
      venues: held.venues,
      current: () => held.venues,
      chains,
      registry: selfHostedChains(),
      poolHooks: selfHostedPoolHooks(),
      reads: composeChainReads({ chains: selfHostedChains(), config: chains, http, clock }),
      secrets,
      http,
      clock,
      logger,
      signal,
    });
    const host = createVenueHost({
      venues: followed.venues,
      chains: selfHostedChains(),
      clock,
      callTimeoutMs: 5_000,
    });
    const trade = {
      venue: "okx",
      wallet: recordedWallet,
      amountIn: { asset: bnb, base: 10n ** 17n },
      assetOut: usdt,
      maxSlippageBps: bpsSchema.parse(100),
    };
    const quoteOnce = async (venues: VenuesConfig) => {
      held.venues = venues;
      await followed.followReload(["venues.keys.okx.apiKey"], signal);
      return host.quote(trade, { signal });
    };
    await quoteOnce(venuesWith("OKX_TWO"));
    const down = { ok: false, error: "venue_down" };
    await expect(quoteOnce(venuesWith())).resolves.toStrictEqual(down);
    await expect(quoteOnce(venuesWith("MISSING"))).resolves.toStrictEqual(down);
    expect(new Set(sent)).toStrictEqual(new Set(["okx_two_key-value"]));
    expect(logger.records().map((record) => record.event)).toStrictEqual(["engine.venue_skipped"]);
  });
});
