import { type ChainRef, chainRefSchema } from "@binference/chain";
import { BinferenceError, createSecret } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { ChainsConfig } from "../config/schema/chains-venues.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import { readRpcUrls } from "./read-rpc-urls.js";

const bsc = chainRefSchema.parse("eip155:56");
const opbnb = chainRefSchema.parse("eip155:204");
const off = chainRefSchema.parse("eip155:97");

// Secrets by environment variable name; a name with no value is unavailable.
const values: ReadonlyMap<string, string> = new Map([
  ["BSC_TRACER", "https://bsc.tracer.invalid/v1/key123"],
  ["OPBNB_TRACER", "http://opbnb.tracer.invalid/"],
  ["OFF_TRACER", "https://off.tracer.invalid/"],
  ["BSC_WS", "wss://bsc.heads.invalid/ws/key123"],
  ["OPBNB_WS", "https://opbnb.heads.invalid/"],
]);

const secrets: SecretReader = {
  async read(path, source) {
    const name = "fromEnv" in source ? source.fromEnv : "";
    const value = values.get(name);
    if (value === undefined) {
      throw new BinferenceError({ code: "config.secret_unavailable", message: `No ${path}.` });
    }
    return Promise.resolve(createSecret(value));
  },
};

function chainsWith(
  urls: Readonly<Record<ChainRef, string>>,
  enabled: readonly ChainRef[],
  kind: "tracer" | "ws" = "tracer",
) {
  const rpc = Object.fromEntries(
    Object.entries(urls).map(([chain, name]) => [chain, { [kind]: { fromEnv: name } }]),
  );
  const chains: ChainsConfig = { enabled, rpc, relays: {}, maxFeePerGasGwei: {} };
  return chains;
}

describe("the owner's own RPC URLs", () => {
  it("reads the tracer of each enabled chain that names one, and only those", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    const chains = chainsWith({ [bsc]: "BSC_TRACER", [off]: "OFF_TRACER" }, [bsc, opbnb]);
    const read = await readRpcUrls(
      { chains, secrets, kind: "tracer" },
      { logger, signal: AbortSignal.timeout(1_000) },
    );
    expect([...read]).toStrictEqual([[bsc, "https://bsc.tracer.invalid/v1/key123"]]);
    expect(logger.records()).toStrictEqual([]);
  });

  it("logs and leaves out a tracer it cannot read or that is no https URL", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    const chains = chainsWith({ [bsc]: "MISSING", [opbnb]: "OPBNB_TRACER" }, [bsc, opbnb]);
    const read = await readRpcUrls(
      { chains, secrets, kind: "tracer" },
      { logger, signal: AbortSignal.timeout(1_000) },
    );
    expect(read.size).toBe(0);
    const logged = logger
      .records()
      .map(({ event, fields }) => [event, fields.chain, fields.errorCode]);
    expect(logged).toStrictEqual([
      ["engine.tracer_skipped", bsc, "config.secret_unavailable"],
      ["engine.tracer_skipped", opbnb, "config.not_https"],
    ]);
    expect(JSON.stringify(logger.records())).not.toContain("tracer.invalid");
  });

  it("reads the WebSocket RPC of each enabled chain, a wss URL only", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    const chains = chainsWith({ [bsc]: "BSC_WS", [opbnb]: "OPBNB_WS" }, [bsc, opbnb], "ws");
    const read = await readRpcUrls(
      { chains, secrets, kind: "ws" },
      { logger, signal: AbortSignal.timeout(1_000) },
    );
    expect([...read]).toStrictEqual([[bsc, "wss://bsc.heads.invalid/ws/key123"]]);
    const logged = logger
      .records()
      .map(({ event, fields }) => [event, fields.chain, fields.errorCode]);
    expect(logged).toStrictEqual([["engine.ws_skipped", opbnb, "config.not_wss"]]);
    expect(JSON.stringify(logger.records())).not.toContain("heads.invalid");
  });
});
