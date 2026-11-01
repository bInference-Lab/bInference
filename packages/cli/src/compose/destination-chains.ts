import { type ChainDefinition, chainRefSchema } from "@binference/chain";
import { createEvmAccountCodeReader, createRpcFailover, evmChainOf } from "@binference/chain-evm";
import {
  createSolanaAccountKindReader,
  createSolanaRpcClient,
  solanaChainOf,
  solanaFamilyId,
} from "@binference/chain-solana";
import type { Clock, Http } from "@binference/core";
import type { EngineOptions } from "@binference/engine";
import { selfHostedDestinations, selfHostedFamilies } from "./self-hosted-destinations.js";

// A node answers an account read within this; past it, the next endpoint is asked.
const solanaReadTimeoutMs = 10_000;
const evmReadTimeoutMs = 10_000;
// An EVM endpoint that failed a read rests this long before it is asked again.
const evmRestMs = 30_000;

type Destination = NonNullable<EngineOptions["destinations"]>[number];
type DestinationReaders = Pick<Destination, "kinds" | "codes">;

// The reader that tells a payee from an account no one spends from as a wallet: Solana's account
// kind reader, or an EVM chain's account code reader, each over the registry's keyless endpoints.
function readersOf(
  definition: ChainDefinition,
  parts: { readonly http: Http; readonly clock: Clock },
): DestinationReaders {
  const endpoints = definition.rpcs.map(({ name, url }) => ({ name, url }));
  const { http, clock } = parts;
  if (definition.family === solanaFamilyId) {
    const rpc = createSolanaRpcClient({ endpoints, http, clock, timeoutMs: solanaReadTimeoutMs });
    return { kinds: createSolanaAccountKindReader({ rpc, chain: solanaChainOf(definition) }) };
  }
  const rpc = createRpcFailover({
    endpoints,
    http,
    clock,
    timeoutMs: evmReadTimeoutMs,
    restMs: evmRestMs,
  });
  return { codes: createEvmAccountCodeReader({ rpc, chain: evmChainOf(definition) }) };
}

/**
 * The chains a bridge delivers to as the engine takes them (decision 0314): each with its family's
 * address codec, on Solana an account kind reader and on an EVM chain an account code reader, each
 * over the registry's keyless endpoints, so a program, a token account or a token's own contract
 * is refused before it is saved (decisions 0298 and 0318).
 */
export function selfHostedDestinationChains(parts: {
  readonly http: Http;
  readonly clock: Clock;
}): readonly Destination[] {
  const families = selfHostedFamilies();
  return selfHostedDestinations().flatMap((definition): readonly Destination[] => {
    const ref = chainRefSchema.parse(definition.id);
    const codec = families.codecOf(ref);
    return codec.ok ? [{ ref, codec: codec.value, ...readersOf(definition, parts) }] : [];
  });
}
