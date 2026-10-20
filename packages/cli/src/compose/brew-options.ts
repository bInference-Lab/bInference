import type { BrewChain, BrewLaunchChain, BrewOptions, BrewPair } from "@binference/brew";
import type { AssetRef, ChainRef, PriceFeedDefinition, RegisteredChain } from "@binference/chain";
import {
  createEvmTxSimulator,
  erc20AssetRef,
  evmChainOf,
  parseEvmAddress,
} from "@binference/chain-evm";
import type { Random } from "@binference/core";
import type { ChainReads } from "./chain-reads.js";
import { wrappedCoinOf } from "./wrapped-coins.js";

// Brew on each enabled chain whose registry lists its single-pair factory and names its wrapped
// coin, which a Brew pool against the coin holds (decision 0278).
function brewChainsOf(
  chains: readonly RegisteredChain[],
  feeds: ReadonlyMap<ChainRef, readonly PriceFeedDefinition[]>,
): readonly BrewChain[] {
  return chains.flatMap((chain) => {
    const isListed = chain.definition.contracts.some(
      (item) => item.venue === "brew" && item.name === "factory",
    );
    const wrappedNative = wrappedCoinOf(chain, feeds.get(chain.ref) ?? []);
    const { nativeAsset } = evmChainOf(chain.definition);
    return isListed && wrappedNative !== undefined
      ? [{ chain: chain.ref, nativeAsset, wrappedNative }]
      : [];
  });
}

// The fixed starts of a Brew launch, in whole units of the pair (decision 0283): 8 of the coin, and
// 5,000 of USDT or USDC; any other registry token starts at $5,000 at binference's price.
const brewCoinStart = 8n;
const brewStableStarts: ReadonlyMap<string, bigint> = new Map([
  ["USDT", 5_000n],
  ["USDC", 5_000n],
]);

// What a Brew token may launch against on the chain: the coin, and every registry token but the
// wrapped coin, each with its decimals and its fixed start, if any.
function brewPairsOf(chain: RegisteredChain, wrappedNative: AssetRef): readonly BrewPair[] {
  const evm = evmChainOf(chain.definition);
  const coin = {
    asset: evm.nativeAsset,
    decimals: evm.nativeDecimals,
    startBase: brewCoinStart * 10n ** BigInt(evm.nativeDecimals),
  };
  const tokens = chain.definition.tokens.flatMap((token): BrewPair[] => {
    const address = parseEvmAddress(token.address);
    const asset = address.ok ? erc20AssetRef(evm, address.value) : undefined;
    if (asset === undefined || asset === wrappedNative) {
      return [];
    }
    const start = brewStableStarts.get(token.symbol);
    const fixed = start === undefined ? {} : { startBase: start * 10n ** BigInt(token.decimals) };
    return [{ asset, decimals: token.decimals, ...fixed }];
  });
  return [coin, ...tokens];
}

// Brew launches on each chain it reads launches on, through the chain's RPC failover, with a
// simulator over it for the quote's dry run (decision 0283).
function brewLaunchChainsOf(
  chains: readonly BrewChain[],
  parts: {
    readonly registry: readonly RegisteredChain[];
    readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  },
): readonly BrewLaunchChain[] {
  return chains.flatMap((item) => {
    const read = parts.reads.get(item.chain);
    const chain = parts.registry.find((entry) => entry.ref === item.chain);
    if (read === undefined || chain === undefined) {
      return [];
    }
    const simulator = createEvmTxSimulator({ rpc: read.rpc, chain: read.evm });
    const pairs = brewPairsOf(chain, item.wrappedNative);
    return [{ chain: item.chain, rpc: read.rpc, simulator, pairs }];
  });
}

/**
 * The `brew` venue's options on the enabled chains (decisions 0278 and 0283): every chain whose
 * registry lists Brew's single-pair factory and names a wrapped coin, read for the launch feed,
 * and each of those the engine reads launching against the coin or any registry token, with the
 * owner's fixed starts.
 */
export function brewOptionsOf(
  enabled: readonly RegisteredChain[],
  parts: {
    readonly feeds: ReadonlyMap<ChainRef, readonly PriceFeedDefinition[]>;
    readonly reads: ReadonlyMap<ChainRef, ChainReads>;
    readonly random: Random;
  },
): BrewOptions {
  const chains = brewChainsOf(enabled, parts.feeds);
  const launchChains = brewLaunchChainsOf(chains, { registry: enabled, reads: parts.reads });
  return { chains, launches: { random: parts.random, chains: launchChains } };
}
