import type { ChainRef } from "@binference/chain";
import { BinferenceError, type Logger } from "@binference/core";
import type { ChainsConfig } from "../config/schema/chains-venues.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";

/**
 * Reads the owner's tracing RPC of each enabled chain that config names one for (decision 0108),
 * by chain. The tracer is a fallback for old blocks, so one that cannot be read, or that is no
 * https URL, is logged with its chain and left out: the engine starts without it.
 */
export async function readTracers(
  chains: ChainsConfig,
  secrets: SecretReader,
  call: { readonly logger: Logger; readonly signal: AbortSignal },
): Promise<ReadonlyMap<ChainRef, string>> {
  const named = chains.enabled.flatMap((chain) => {
    const source = chains.rpc[chain]?.tracer;
    return source === undefined ? [] : [{ chain, source }];
  });
  const read = await Promise.all(
    named.map(async ({ chain, source }) => {
      const path = `chains.rpc.${chain}.tracer`;
      try {
        const url = URL.parse((await secrets.read(path, source, call.signal)).reveal());
        if (url?.protocol === "https:") {
          return [[chain, url.href] as const];
        }
        call.logger.warn("engine.tracer_skipped", { chain, errorCode: "config.not_https" });
      } catch (error) {
        call.signal.throwIfAborted();
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        call.logger.warn("engine.tracer_skipped", { chain, errorCode });
      }
      return [];
    }),
  );
  return new Map(read.flat());
}
