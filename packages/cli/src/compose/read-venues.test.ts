import { chainRefSchema } from "@binference/chain";
import { BinferenceError, createSecret } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createScriptedHttp,
} from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { VenuesConfig } from "../config/schema/chains-venues.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains } from "./open-engine-parts.js";
import { readVenues } from "./read-venues.js";

const bsc = chainRefSchema.parse("eip155:56");

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
    venues,
    chains,
    registry: selfHostedChains(),
    reads: composeChainReads({ chains: selfHostedChains(), config: chains, http, clock }),
    secrets,
    http,
    clock,
    logger,
    signal: new AbortController().signal,
  });
  return { ids: venuesRead.map((venue) => venue.id), logger };
}

describe("the self-hosted venues", () => {
  it("read Flap's curves on each chain through that chain's one RPC failover", async () => {
    const http = createScriptedHttp([]);
    const clock = createManualClock();
    const chains = { enabled: [bsc], rpc: {}, relays: {}, maxFeePerGasGwei: { [bsc]: "1" } };
    const reads = composeChainReads({ chains: selfHostedChains(), config: chains, http, clock });
    const venues = await readVenues({
      venues: venuesWith(),
      chains,
      registry: selfHostedChains(),
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
  });

  it("quote through KyberSwap and the Flap launchpad when config names no OKX key", async () => {
    const { ids, logger } = await read(venuesWith());
    expect(ids).toStrictEqual(["kyberswap", "flap"]);
    expect(logger.records()).toStrictEqual([]);
  });

  it("add OKX when config names the owner's OKX key", async () => {
    await expect(read(venuesWith("OKX"))).resolves.toMatchObject({
      ids: ["kyberswap", "flap", "okx"],
    });
  });

  it("leave OKX out, and say so, when its key cannot be read", async () => {
    const { ids, logger } = await read(venuesWith("MISSING"));
    expect(ids).toStrictEqual(["kyberswap", "flap"]);
    expect(logger.records().map((record) => record.event)).toStrictEqual(["engine.venue_skipped"]);
  });
});
