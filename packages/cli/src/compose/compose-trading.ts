import type { Amount, ChainRef, PriceSource } from "@binference/chain";
import type { PositionStore, WalletFactsSource } from "@binference/engine";
import { composePrices } from "./chain-prices.js";
import type { ChainReads } from "./chain-reads.js";
import { type ComposedSimulators, composeSimulators } from "./chain-simulators.js";
import { createChainWalletFacts } from "./chain-wallet-facts.js";
import { type Opened, type Opening, selfHostedFeeds } from "./open-engine-parts.js";
import { paperBalancesOf } from "./paper-balances.js";

/** What the self-hosted engine trades on, each part over the chains' one set of reads. */
export interface TradingParts {
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  /** Chainlink feeds (decision 0059). */
  readonly prices: PriceSource;
  /** The install's wallets with their balances, fees and ceilings read on chain. */
  readonly wallets: WalletFactsSource;
  /** `eth_simulateV1`, and the engine's simulation check over it. */
  readonly simulators: ComposedSimulators;
  /** The positions on `engine.sqlite`. */
  readonly positions: PositionStore;
  /** What a paper portfolio starts with: config's `defaults.paper.balances`. */
  readonly paperBalances: readonly Amount[];
}

/**
 * The self-hosted engine's trading parts over the chains' one set of reads: the Chainlink prices,
 * the wallets' facts read on chain, the simulators, the stored positions and the paper balances.
 */
export function composeTrading(opening: Opening, opened: Opened): TradingParts {
  const { clock } = opening.host;
  const { config, stores, chains, reads } = opened;
  const { install, intents, positions } = stores;
  return {
    reads,
    prices: composePrices(reads, { feeds: selfHostedFeeds(), clock }),
    wallets: createChainWalletFacts({ install, intents, reads, clock }),
    simulators: composeSimulators(reads, { chains, clock }),
    positions,
    paperBalances: paperBalancesOf(config.defaults.paper.balances, reads),
  };
}
