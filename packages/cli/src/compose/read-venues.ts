import type { AssetRef, ChainRef, ChainRegistry, RegisteredChain, Venue } from "@binference/chain";
import {
  erc20AssetRef,
  type EvmChain,
  evmChainOf,
  evmFamilyId,
  parseEvmAddress,
} from "@binference/chain-evm";
import { BinferenceError, type Clock, type Http, type Logger } from "@binference/core";
import { createFlapVenue, type FlapChain } from "@binference/flap";
import { createKyberswapVenue } from "@binference/kyberswap";
import { createOkxVenue, type OkxKeys } from "@binference/okx";
import type { ChainsConfig, VenuesConfig } from "../config/schema/chains-venues.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import type { ChainReads } from "./chain-reads.js";

/** What the venues are read with. */
export interface ReadVenuesOptions {
  readonly venues: VenuesConfig;
  readonly chains: Pick<ChainsConfig, "enabled">;
  readonly registry: ChainRegistry;
  /** Each enabled chain's reads, whose RPC failover a launchpad reads its contracts through. */
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  readonly secrets: SecretReader;
  readonly http: Http;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly signal: AbortSignal;
}

// The owner's OKX key, or `undefined` when config names none or a part of it cannot be read.
async function okxKeysOf(options: ReadVenuesOptions): Promise<OkxKeys | undefined> {
  const named = options.venues.keys.okx;
  if (named === undefined) {
    return undefined;
  }
  const { secrets, signal } = options;
  try {
    const [apiKey, secretKey, passphrase] = await Promise.all([
      secrets.read("venues.keys.okx.apiKey", named.apiKey, signal),
      secrets.read("venues.keys.okx.secret", named.secret, signal),
      secrets.read("venues.keys.okx.passphrase", named.passphrase, signal),
    ]);
    return { apiKey, secretKey, passphrase };
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("engine.venue_skipped", { errorCode });
    return undefined;
  }
}

// The stablecoins Flap's Portal lists as quote tokens of its curves (`getQuoteTokenConfiguration`),
// read on BNB Smart Chain on 2026-10-12. A chain whose registry lists none of them gives none.
const flapQuoteSymbols: ReadonlySet<string> = new Set(["USDT", "USD1"]);

function flapQuoteTokens(chain: RegisteredChain, evm: EvmChain): readonly AssetRef[] {
  return chain.definition.tokens
    .filter((token) => flapQuoteSymbols.has(token.symbol))
    .flatMap((token) => {
      const address = parseEvmAddress(token.address);
      return address.ok ? [erc20AssetRef(evm, address.value)] : [];
    });
}

// Flap on each chain the engine reads, through that chain's one RPC failover.
function flapChains(
  chains: readonly RegisteredChain[],
  reads: ReadonlyMap<ChainRef, ChainReads>,
): readonly FlapChain[] {
  return chains.flatMap((chain) => {
    const read = reads.get(chain.ref);
    if (read === undefined) {
      return [];
    }
    const quoteTokens = flapQuoteTokens(chain, read.evm);
    return [{ chain: chain.ref, nativeAsset: read.evm.nativeAsset, quoteTokens, rpc: read.rpc }];
  });
}

/**
 * The venues the self-hosted engine quotes on, on each enabled chain of the EVM family: KyberSwap,
 * keyless, always; the Flap launchpad, over each chain's RPC failover, always; OKX's DEX
 * aggregator only when `venues.keys.okx` names the owner's key (decision 0105). The money path
 * asks every venue an agent allows and keeps the best plan (decision 0107), and sends a token on
 * Flap's curve to Flap alone (decision 0179). An OKX key that cannot be read is logged and OKX
 * left out: KyberSwap still routes. No pool hook is on the allowlist yet, so routes through hooked
 * pools are dropped.
 */
export async function readVenues(options: ReadVenuesOptions): Promise<readonly Venue[]> {
  const enabled = options.registry
    .list()
    .filter((chain) => chain.definition.family === evmFamilyId)
    .filter((chain) => options.chains.enabled.includes(chain.ref));
  const chains = enabled.map((chain) => ({
    chain: chain.ref,
    nativeAsset: evmChainOf(chain.definition).nativeAsset,
  }));
  const { http, clock } = options;
  const kyberswap = createKyberswapVenue({
    http,
    clientId: options.venues.kyberClientId,
    chains: chains.map((chain) => ({ ...chain, allowedHooks: [] })),
  });
  const flap = createFlapVenue({ chains: flapChains(enabled, options.reads) });
  const keys = await okxKeysOf(options);
  return keys === undefined
    ? [kyberswap, flap]
    : [kyberswap, flap, createOkxVenue({ http, clock, keys, chains })];
}
