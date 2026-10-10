import type { Amount, ChainRegistry, PriceSource } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { IntentStore, PositionStore, Simulator, WalletFactsSource } from "../ports.js";
import { createPositions, type Positions } from "../positions/create-positions.js";
import { createPaperPortfolio, type PaperPortfolio } from "./paper-portfolio.js";
import { withPaperSimulation } from "./paper-simulation.js";
import { withPaperBalances } from "./paper-wallet-facts.js";

/** The engine's paper parts: the positions, the paper portfolio, and the steps that read it. */
export interface PaperParts {
  readonly positions: Positions;
  readonly portfolio: PaperPortfolio;
  /** The wallet facts with paper balances from the paper portfolio. */
  readonly wallets: WalletFactsSource;
  /** The simulate step with a paper intent's balances from the paper portfolio. */
  readonly simulator: Simulator;
}

/** What the paper parts are built from: the engine's own options. */
export interface PaperPartsOptions {
  readonly positions: PositionStore;
  readonly prices: PriceSource;
  /** The wallets' live facts, which the paper parts wrap. */
  readonly wallets: WalletFactsSource;
  /** The simulate step, which the paper parts wrap. */
  readonly simulator: Simulator;
  /** A paper reset's starting balances when it names none. */
  readonly paperBalances: readonly Amount[];
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly stores: { readonly intents: IntentStore };
}

/**
 * Builds the paper parts: positions valued at the price source, the paper portfolio over them, and
 * the wallet facts and simulate step that read a paper intent's balances from that portfolio.
 */
export function createPaperParts(options: PaperPartsOptions): PaperParts {
  const positions = createPositions({ store: options.positions, prices: options.prices });
  const portfolio = createPaperPortfolio({
    positions,
    store: options.positions,
    wallets: options.wallets,
    clock: options.clock,
    startingBalances: options.paperBalances,
  });
  const wallets = withPaperBalances(options.wallets, { portfolio, chains: options.chains });
  const simulator = withPaperSimulation(options.simulator, {
    portfolio,
    intents: options.stores.intents,
    chains: options.chains,
    clock: options.clock,
  });
  return { positions, portfolio, wallets, simulator };
}
