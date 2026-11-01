import { chainRefSchema } from "@binference/chain";
import {
  createSolanaAccountKindReader,
  createSolanaRpcClient,
  solanaChainOf,
  solanaFamilyId,
} from "@binference/chain-solana";
import type { Clock, Http } from "@binference/core";
import type { EngineOptions } from "@binference/engine";
import { selfHostedDestinations, selfHostedFamilies } from "./self-hosted-destinations.js";

// A Solana node answers an account read within this; past it, the next endpoint is asked.
const solanaReadTimeoutMs = 10_000;

/**
 * The chains a bridge delivers to as the engine takes them (decision 0314): each with its family's
 * address codec, and on Solana an account kind reader over the registry's keyless endpoints, so a
 * program or a token account is refused before it is saved (decision 0298).
 */
export function selfHostedDestinationChains(parts: {
  readonly http: Http;
  readonly clock: Clock;
}): NonNullable<EngineOptions["destinations"]> {
  const families = selfHostedFamilies();
  return selfHostedDestinations().flatMap((definition) => {
    const ref = chainRefSchema.parse(definition.id);
    const codec = families.codecOf(ref);
    if (!codec.ok) {
      return [];
    }
    if (definition.family !== solanaFamilyId) {
      return [{ ref, codec: codec.value }];
    }
    const rpc = createSolanaRpcClient({
      endpoints: definition.rpcs.map(({ name, url }) => ({ name, url })),
      http: parts.http,
      clock: parts.clock,
      timeoutMs: solanaReadTimeoutMs,
    });
    const kinds = createSolanaAccountKindReader({ rpc, chain: solanaChainOf(definition) });
    return [{ ref, codec: codec.value, kinds }];
  });
}
