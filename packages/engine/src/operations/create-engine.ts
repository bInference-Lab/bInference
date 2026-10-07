import type { Amount, ChainRegistry, PriceSource, Signer } from "@binference/chain";
import type { Clock, IdSource, Random } from "@binference/core";
import { type ApprovalHandlers, createApprovalHandlers } from "../approval/approval-handlers.js";
import { createConfirmations } from "../confirmations/create-confirmations.js";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import { createMoneyPath } from "../money-path/create-money-path.js";
import { createExecuteConfirmed } from "../money-path/execute-confirmed.js";
import { createVenueQuoteSource } from "../money-path/venue-quote-source.js";
import { createPaperFills } from "../paper/paper-fills.js";
import { createPaperPortfolio, type PaperPortfolio } from "../paper/paper-portfolio.js";
import { withPaperSimulation } from "../paper/paper-simulation.js";
import { withPaperBalances } from "../paper/paper-wallet-facts.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { Executor, PositionStore, Simulator, WalletFactsSource } from "../ports.js";
import { createPositions, type Positions } from "../positions/create-positions.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
import type { VenueHost } from "../venues/venue-host.js";
import { type AgentModeHandlers, createAgentModeHandlers } from "./agent-mode-handlers.js";
import { type AnswerCard, createAnswerCard } from "./answer-card.js";
import { createIntentHandlers, type IntentHandlers } from "./intent-handlers.js";
import { createLedgerHandlers, type LedgerHandlers } from "./ledger-handlers.js";
import { createPortfolioHandlers, type PortfolioHandlers } from "./portfolio-handlers.js";
import { createWalletHandlers, type WalletHandlers } from "./wallet-handlers.js";

/** The operation handlers the engine gives the protocol server, by operation name. */
export interface EngineHandlers
  extends
    IntentHandlers,
    LedgerHandlers,
    PortfolioHandlers,
    AgentModeHandlers,
    ApprovalHandlers,
    WalletHandlers {}

/**
 * The engine's use cases behind the protocol: the money path, confirmations, paper mode, the mode
 * switch, the approval mode, the wallet list and the ledger, built from ports. It holds no I/O of its own; pushes
 * leave through `publish`.
 */
export interface Engine {
  /** The handlers to pass to the protocol server, which checks scopes and keys before each. */
  readonly handlers: EngineHandlers;
  /** Applies a card answer from a surface the engine serves itself, such as a Telegram tap. */
  readonly answer: AnswerCard;
}

/** The ports and adapters the composition root builds the engine from. */
export interface EngineOptions {
  readonly stores: EngineStores;
  /** Executions, arrivals and positions, live and paper; the paper portfolio lives here. */
  readonly positions: PositionStore;
  /** Custody: the agent wallets' accounts, and later their signatures. */
  readonly custody: Signer;
  readonly prices: PriceSource;
  /** The wallets' live facts; a paper intent's balance comes from the paper portfolio. */
  readonly wallets: WalletFactsSource;
  /** The venue host over every venue the engine may use. */
  readonly host: VenueHost;
  readonly simulator: Simulator;
  /** Takes each confirmed live intent onto its wallet's queue; it never sees a paper intent. */
  readonly executor: Executor;
  /** A paper reset's starting balances when it names none: 1 BNB and 500 USDT by default. */
  readonly paperBalances: readonly Amount[];
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** Where each card version's callback reference comes from (spec 4, section 2). */
  readonly random: Random;
  /** Where pushes go: the protocol server, which numbers them with a `seq` per topic. */
  readonly publish: PublishPush;
}

interface PaperParts {
  readonly positions: Positions;
  readonly portfolio: PaperPortfolio;
  /** The wallet facts with paper balances from the paper portfolio. */
  readonly wallets: WalletFactsSource;
  /** The simulate step with a paper intent's balances from the paper portfolio. */
  readonly simulator: Simulator;
}

function paperParts(options: EngineOptions): PaperParts {
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
  });
  return { positions, portfolio, wallets, simulator };
}

function settingsHandlers(
  options: EngineOptions,
  paper: PaperParts,
): PortfolioHandlers & AgentModeHandlers & WalletHandlers {
  const { stores, chains } = options;
  const portfolio = createPortfolioHandlers({
    agents: stores.agents,
    portfolio: paper.portfolio,
    positions: paper.positions,
    chains,
  });
  const modes = createAgentModeHandlers({
    agents: stores.agents,
    journal: stores.configJournal,
    wallets: options.wallets,
    custody: options.custody,
    chains,
    clock: options.clock,
    publish: options.publish,
  });
  const wallets = createWalletHandlers({
    agents: stores.agents,
    wallets: stores.wallets,
    custody: options.custody,
    chains,
  });
  return { ...portfolio, ...modes, ...wallets };
}

function intentParts(
  options: EngineOptions,
  paper: PaperParts,
): { readonly handlers: IntentHandlers; readonly answer: AnswerCard } {
  const { stores, custody, host, chains, clock, ids } = options;
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids,
    random: options.random,
    publish: options.publish,
  });
  const fills = createPaperFills({
    stored,
    positions: paper.positions,
    prices: options.prices,
    clock,
  });
  const execute = createExecuteConfirmed({ paper: fills, executor: options.executor });
  const confirmations = createConfirmations({
    clock,
    store: stored,
    quotes: createVenueQuoteSource({ stored, custody, host, chains }),
    simulator: paper.simulator,
  });
  const answer = createAnswerCard({ confirmations, stored, execute });
  const moneyPath = createMoneyPath({
    stored,
    agents: stores.agents,
    custody,
    wallets: paper.wallets,
    policy: createPolicyCheck({ prices: options.prices, clock }),
    host,
    simulator: paper.simulator,
    chains,
    execute,
    clock,
    ids,
  });
  return { answer, handlers: createIntentHandlers({ stored, moneyPath, answer, chains }) };
}

/**
 * Creates the {@link Engine}. Every write of an intent goes through one writer, which pushes
 * `intent`, card and `ledger` events as each write lands. A confirmed paper intent fills at its
 * confirmed quote in the paper portfolio; a confirmed live one goes to the executor.
 */
export function createEngine(options: EngineOptions): Engine {
  const paper = paperParts(options);
  const intents = intentParts(options, paper);
  return {
    handlers: {
      ...intents.handlers,
      ...createLedgerHandlers(options.stores.ledger),
      ...settingsHandlers(options, paper),
      ...createApprovalHandlers({
        agents: options.stores.agents,
        journal: options.stores.configJournal,
        clock: options.clock,
        publish: options.publish,
      }),
    },
    answer: intents.answer,
  };
}
