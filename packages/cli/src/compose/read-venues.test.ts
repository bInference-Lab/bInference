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
  const venuesRead = await readVenues({
    venues,
    chains: { enabled: [bsc] },
    registry: selfHostedChains(),
    secrets,
    http: createScriptedHttp([]),
    clock: createManualClock(),
    logger,
    signal: new AbortController().signal,
  });
  return { ids: venuesRead.map((venue) => venue.id), logger };
}

describe("the self-hosted venues", () => {
  it("quote through KyberSwap alone when config names no OKX key", async () => {
    const { ids, logger } = await read(venuesWith());
    expect(ids).toStrictEqual(["kyberswap"]);
    expect(logger.records()).toStrictEqual([]);
  });

  it("add OKX when config names the owner's OKX key", async () => {
    await expect(read(venuesWith("OKX"))).resolves.toMatchObject({ ids: ["kyberswap", "okx"] });
  });

  it("leave OKX out, and say so, when its key cannot be read", async () => {
    const { ids, logger } = await read(venuesWith("MISSING"));
    expect(ids).toStrictEqual(["kyberswap"]);
    expect(logger.records().map((record) => record.event)).toStrictEqual(["engine.venue_skipped"]);
  });
});
