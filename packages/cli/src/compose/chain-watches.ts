import {
  type AssetRef,
  assetRefParts,
  type ChainRef,
  type PriceFeedDefinition,
  type RegisteredChain,
} from "@binference/chain";
import {
  createBlockSource,
  createPoolPriceReader,
  createPriceWatcher,
  type FeedAsset,
  feedAssetsOf,
  type HeadSocketFactory,
  parseEvmAddress,
  type PlanPrices,
  poolSource,
  type ReadQuarantine,
} from "@binference/chain-evm";
import { type Clock, err, type Logger, ok } from "@binference/core";
import type { VenueHost } from "@binference/engine";
import type { Address } from "viem";
import type { ChainReads } from "./chain-reads.js";
import { type ChainWatch, createChainWatch } from "./chain-watch.js";

/** What every chain's price watcher is made from. */
export interface ChainWatchesOptions {
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  /** The venue host, which asks the venues how they price a token. */
  readonly venues: Pick<VenueHost, "priceRead">;
  /** The Chainlink feeds of each chain, which price the quote assets in USD. */
  readonly feeds: ReadonlyMap<ChainRef, readonly PriceFeedDefinition[]>;
  /** The owner's WebSocket RPC of each chain that config names one for. */
  readonly headSockets: ReadonlyMap<ChainRef, string>;
  readonly openSocket: HeadSocketFactory;
  readonly clock: Clock;
  readonly logger: Logger;
}

// A socket silent for this long, about six blocks on BNB Smart Chain, is dead; it is tried again
// after 30 seconds of polling.
const headTimeoutMs = 3_000;
const socketRestMs = 30_000;
// A read of every block gives one endpoint this long, about three blocks on BNB Smart Chain, before
// the next is asked (decision 0194).
const watchCallTimeoutMs = 1_500;
// PancakeSwap v3's fee tiers, in hundredths of a basis point.
const v3Fees = [100, 500, 2_500, 10_000];
// A pool must hold at least $1,000 of its quote token to price a token.
const minDepthUsdMicros = 1_000_000_000n;

function factoryOf(chain: RegisteredChain, name: string): Address | undefined {
  const listed = chain.definition.contracts.find(
    (contract) => contract.venue === "pancakeswap" && contract.name === name,
  );
  const address = listed === undefined ? undefined : parseEvmAddress(listed.address);
  return address?.ok === true ? address.value : undefined;
}

// The quote tokens a pool may pair a token with: the chain's tokens with a Chainlink feed.
function poolQuotes(feeds: readonly FeedAsset[]): readonly FeedAsset[] {
  return feeds.filter(({ asset }) => assetRefParts(asset).assetNamespace === "erc20");
}

// A venue's own read first, the launchpad's while the token is on its curve; else the pools.
function planPricesOf(
  options: ChainWatchesOptions,
  pools: ReturnType<typeof createPoolPriceReader>,
): PlanPrices {
  return async (token: AssetRef, signal: AbortSignal) => {
    const hosted = await options.venues.priceRead(token, { signal });
    if (hosted.ok) {
      return ok({ source: hosted.value.venue, read: hosted.value });
    }
    if (hosted.error === "venue_down") {
      return err("venue_down");
    }
    const read = await pools.priceRead({ token, contracts: {} }, { signal });
    return read.ok ? ok({ source: poolSource, read: read.value }) : read;
  };
}

// A token whose calls fail a block's whole batch leaves it for 30 s; the log says which and why.
function quarantineLog(logger: Logger, chain: ChainRef): (quarantine: ReadQuarantine) => void {
  return ({ token, code }) => {
    logger.warn("watcher.read_quarantined", { chain, assetId: token, errorCode: code });
  };
}

function watchOf(options: ChainWatchesOptions, reads: ChainReads): ChainWatch {
  const { clock } = options;
  const { rpc, evm, multicall, chain } = reads;
  const feeds = feedAssetsOf(chain.definition, options.feeds.get(chain.ref) ?? []);
  const { blockTimeMs } = chain.definition;
  const url = options.headSockets.get(chain.ref);
  const subscription =
    url === undefined
      ? {}
      : { subscription: { url, open: options.openSocket, headTimeoutMs, restMs: socketRestMs } };
  const blocks = createBlockSource({
    rpc,
    clock,
    blockTimeMs,
    callTimeoutMs: watchCallTimeoutMs,
    ...subscription,
  });
  const v2Factory = factoryOf(chain, "v2-factory");
  const v3Factory = factoryOf(chain, "v3-factory");
  const pools = createPoolPriceReader({
    rpc,
    chain: evm,
    clock,
    multicall,
    ...(v2Factory === undefined ? {} : { v2Factory }),
    ...(v3Factory === undefined ? {} : { v3Factory }),
    v3Fees,
    quotes: poolQuotes(feeds),
    minDepthUsdMicros,
  });
  const planPrices = planPricesOf(options, pools);
  const watcher = createPriceWatcher({
    rpc,
    blocks,
    clock,
    multicall,
    blockTimeMs,
    planPrices,
    feeds,
    callTimeoutMs: watchCallTimeoutMs,
    onQuarantine: quarantineLog(options.logger, chain.ref),
  });
  return createChainWatch({ chain, watcher, clock, logger: options.logger });
}

/**
 * One price watcher for each chain the engine reads (decisions 0192 and 0193): new blocks through
 * the owner's WebSocket RPC when config names one, else by polling the chain's failover; each
 * token priced by the venue that holds its price, else by its deepest PancakeSwap pool against a
 * token with a Chainlink feed; every price read once a block in one Multicall3 call.
 */
export function composeChainWatches(
  options: ChainWatchesOptions,
): ReadonlyMap<ChainRef, ChainWatch> {
  return new Map([...options.reads].map(([chain, reads]) => [chain, watchOf(options, reads)]));
}
