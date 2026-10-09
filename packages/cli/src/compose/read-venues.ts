import type { ChainRegistry, Venue } from "@binference/chain";
import { evmChainOf, evmFamilyId } from "@binference/chain-evm";
import { BinferenceError, type Clock, type Http, type Logger } from "@binference/core";
import { createKyberswapVenue } from "@binference/kyberswap";
import { createOkxVenue, type OkxKeys } from "@binference/okx";
import type { ChainsConfig, VenuesConfig } from "../config/schema/chains-venues.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";

/** What the venues are read with. */
export interface ReadVenuesOptions {
  readonly venues: VenuesConfig;
  readonly chains: Pick<ChainsConfig, "enabled">;
  readonly registry: ChainRegistry;
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

/**
 * The venues the self-hosted engine quotes on, on each enabled chain of the EVM family: KyberSwap,
 * keyless, always; OKX's DEX aggregator only when `venues.keys.okx` names the owner's key
 * (decision 0105). The money path asks every venue an agent allows and keeps the best plan
 * (decision 0107). An OKX key that cannot be read is logged and OKX left out: KyberSwap still
 * routes. No pool hook is on the allowlist yet, so routes through hooked pools are dropped.
 */
export async function readVenues(options: ReadVenuesOptions): Promise<readonly Venue[]> {
  const chains = options.registry
    .list()
    .filter((chain) => chain.definition.family === evmFamilyId)
    .filter((chain) => options.chains.enabled.includes(chain.ref))
    .map((chain) => ({ chain: chain.ref, nativeAsset: evmChainOf(chain.definition).nativeAsset }));
  const { http, clock } = options;
  const kyberswap = createKyberswapVenue({
    http,
    clientId: options.venues.kyberClientId,
    chains: chains.map((chain) => ({ ...chain, allowedHooks: [] })),
  });
  const keys = await okxKeysOf(options);
  return keys === undefined
    ? [kyberswap]
    : [kyberswap, createOkxVenue({ http, clock, keys, chains })];
}
