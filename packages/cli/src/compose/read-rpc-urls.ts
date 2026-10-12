import type { ChainRef } from "@binference/chain";
import { BinferenceError, type Logger } from "@binference/core";
import type { ChainsConfig } from "../config/schema/chains-venues.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";

/**
 * Which RPC of the owner's to read for each chain: the tracing RPC (decision 0108), an `https:`
 * URL, or the RPC that pushes new blocks (decision 0192), a `wss:` URL.
 */
type RpcUrlKind = "tracer" | "ws";

const protocols: Readonly<Record<RpcUrlKind, string>> = { tracer: "https:", ws: "wss:" };
const wrongProtocol: Readonly<Record<RpcUrlKind, string>> = {
  tracer: "config.not_https",
  ws: "config.not_wss",
};

/** What to read the owner's RPC URLs from, and which of them. */
export interface RpcUrlsRequest {
  readonly chains: ChainsConfig;
  readonly secrets: SecretReader;
  readonly kind: RpcUrlKind;
}

/**
 * Reads one kind of the owner's RPC URL for each enabled chain that config names one for, by chain.
 * Both are a chain's extras, so one that cannot be read, or whose URL has another protocol, is
 * logged as `engine.<kind>_skipped` with its chain and left out, never with its URL, which may
 * carry a key: the engine starts without it.
 */
export async function readRpcUrls(
  request: RpcUrlsRequest,
  call: { readonly logger: Logger; readonly signal: AbortSignal },
): Promise<ReadonlyMap<ChainRef, string>> {
  const { chains, secrets, kind } = request;
  const named = chains.enabled.flatMap((chain) => {
    const source = chains.rpc[chain]?.[kind];
    return source === undefined ? [] : [{ chain, source }];
  });
  const read = await Promise.all(
    named.map(async ({ chain, source }) => {
      const path = `chains.rpc.${chain}.${kind}`;
      try {
        const url = URL.parse((await secrets.read(path, source, call.signal)).reveal());
        if (url?.protocol === protocols[kind]) {
          return [[chain, url.href] as const];
        }
        call.logger.warn(`engine.${kind}_skipped`, { chain, errorCode: wrongProtocol[kind] });
      } catch (error) {
        call.signal.throwIfAborted();
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        call.logger.warn(`engine.${kind}_skipped`, { chain, errorCode });
      }
      return [];
    }),
  );
  return new Map(read.flat());
}
