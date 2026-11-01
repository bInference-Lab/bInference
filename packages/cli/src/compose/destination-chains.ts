import { assetRefSchema, type ChainDefinition, chainRefSchema } from "@binference/chain";
import {
  createEvmAccountCodeReader,
  createRpcFailover,
  erc20Namespace,
  evmChainOf,
} from "@binference/chain-evm";
import {
  createSolanaAccountKindReader,
  createSolanaRpcClient,
  solanaChainOf,
  solanaFamilyId,
  solanaTokenNamespace,
} from "@binference/chain-solana";
import type { Clock, Http } from "@binference/core";
import type { EngineOptions } from "@binference/engine";
import type { AssetInfos } from "@binference/protocol";
import { selfHostedDestinations, selfHostedFamilies } from "./self-hosted-destinations.js";

// A node answers an account read within this; past it, the next endpoint is asked.
const solanaReadTimeoutMs = 10_000;
const evmReadTimeoutMs = 10_000;
// An EVM endpoint that failed a read rests this long before it is asked again.
const evmRestMs = 30_000;

type Destination = NonNullable<EngineOptions["destinations"]>[number];

// The registry's coin and tokens of a destination, each verified, as its cards name them.
function registryAssetsOf(definition: ChainDefinition): AssetInfos {
  const { nativeAsset, tokens } = definition;
  const coin = `${definition.id}/${nativeAsset.assetNamespace}:${nativeAsset.assetReference}`;
  const namespace = definition.family === solanaFamilyId ? solanaTokenNamespace : erc20Namespace;
  const listed = [
    [coin, nativeAsset] as const,
    ...tokens.map((token) => [`${definition.id}/${namespace}:${token.address}`, token] as const),
  ];
  return Object.fromEntries(
    listed.map(([asset, { symbol, name, decimals }]) => [
      assetRefSchema.parse(asset),
      { symbol, name, decimals, verified: true },
    ]),
  );
}
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
    if (!codec.ok) {
      return [];
    }
    const named = { ref, name: definition.name, assets: registryAssetsOf(definition) };
    return [{ ...named, codec: codec.value, ...readersOf(definition, parts) }];
  });
}
