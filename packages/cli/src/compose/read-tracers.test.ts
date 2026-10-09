import { type ChainRef, chainRefSchema } from "@binference/chain";
import { BinferenceError, createSecret } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { ChainsConfig } from "../config/schema/chains-venues.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import { readTracers } from "./read-tracers.js";

const bsc = chainRefSchema.parse("eip155:56");
const opbnb = chainRefSchema.parse("eip155:204");
const off = chainRefSchema.parse("eip155:97");

// Secrets by environment variable name; a name with no value is unavailable.
const values: ReadonlyMap<string, string> = new Map([
  ["BSC_TRACER", "https://bsc.tracer.invalid/v1/key123"],
  ["OPBNB_TRACER", "http://opbnb.tracer.invalid/"],
  ["OFF_TRACER", "https://off.tracer.invalid/"],
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

function chainsWith(tracers: Readonly<Record<ChainRef, string>>, enabled: readonly ChainRef[]) {
  const rpc = Object.fromEntries(
    Object.entries(tracers).map(([chain, name]) => [chain, { tracer: { fromEnv: name } }]),
  );
  const chains: ChainsConfig = { enabled, rpc, relays: {}, maxFeePerGasGwei: {} };
  return chains;
}

describe("the owner's tracing RPCs", () => {
  it("reads the tracer of each enabled chain that names one, and only those", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    const chains = chainsWith({ [bsc]: "BSC_TRACER", [off]: "OFF_TRACER" }, [bsc, opbnb]);
    const read = await readTracers(chains, secrets, { logger, signal: AbortSignal.timeout(1_000) });
    expect([...read]).toStrictEqual([[bsc, "https://bsc.tracer.invalid/v1/key123"]]);
    expect(logger.records()).toStrictEqual([]);
  });

  it("logs and leaves out a tracer it cannot read or that is no https URL", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    const chains = chainsWith({ [bsc]: "MISSING", [opbnb]: "OPBNB_TRACER" }, [bsc, opbnb]);
    const read = await readTracers(chains, secrets, { logger, signal: AbortSignal.timeout(1_000) });
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
});
