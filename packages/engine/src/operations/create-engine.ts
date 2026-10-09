import type { Amount, ChainRegistry, PriceSource, Signer, TxSimulator } from "@binference/chain";
import type { Clock, IdSource, Random } from "@binference/core";
import {
  type AddressBookHandlers,
  createAddressBookHandlers,
} from "../address-book/address-book-handlers.js";
import { withLimitsInEffect } from "../agents/limits-in-effect.js";
import { type ApprovalHandlers, createApprovalHandlers } from "../approval/approval-handlers.js";
import {
  type ConfigHistoryHandlers,
  createConfigHistoryHandlers,
} from "../audit/config-history-handlers.js";
import { createConfirmations } from "../confirmations/create-confirmations.js";
import { createLowGasAlerts } from "../gas/low-gas-alerts.js";
import { createStoredIntents, type StoredIntents } from "../intents/create-stored-intents.js";
import { createLimitHandlers, type LimitHandlers } from "../limits/limit-handlers.js";
import { createMoneyPath } from "../money-path/create-money-path.js";
import { createExecuteConfirmed, type ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import {
  createVenueQuoteSource,
  type VenueQuoteSourceOptions,
} from "../money-path/venue-quote-source.js";
import { createPaperFills } from "../paper/paper-fills.js";
import { createPaperPortfolio, type PaperPortfolio } from "../paper/paper-portfolio.js";
import { withPaperSimulation } from "../paper/paper-simulation.js";
import { withPaperBalances } from "../paper/paper-wallet-facts.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type {
  CeilingEditor,
  Executor,
  PositionStore,
  RiskCheck,
  Simulator,
  WalletFactsSource,
} from "../ports.js";
import { createPositions, type Positions } from "../positions/create-positions.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
import {
  createRescueAddressHandlers,
  type RescueAddressHandlers,
} from "../safety/rescue-address-handlers.js";
import { settleRescueCeilings } from "../safety/rescue-ceilings.js";
import { createSafetyHandlers, type SafetyHandlers } from "../safety/safety-handlers.js";
import { writeUnfreeze } from "../safety/write-unfreeze.js";
import {
  createSendLevelHandlers,
  type SendLevelHandlers,
} from "../send-levels/send-level-handlers.js";
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
    ConfigHistoryHandlers,
    PortfolioHandlers,
    AgentModeHandlers,
    ApprovalHandlers,
    LimitHandlers,
    SendLevelHandlers,
    AddressBookHandlers,
    RescueAddressHandlers,
    SafetyHandlers,
    WalletHandlers {}

/**
 * The engine's use cases behind the protocol: the money path, confirmations, paper mode, the mode
 * switch, the approval mode, the limits, the send level, the address book, the rescue address
 * change, the freeze, the wallet list and the ledger, built from ports. A looser limit, send level
 * or rescue address waits 24 hours. It holds no I/O of its own; pushes leave through `publish`.
 */
export interface Engine {
  /** The handlers to pass to the protocol server, which checks scopes and keys before each. */
  readonly handlers: EngineHandlers;
  /** Applies a card answer from a surface the engine serves itself, such as a Telegram tap. */
  readonly answer: AnswerCard;
  /**
   * Does the work that waits for its time: once a new rescue address takes effect, it sends the
   * change that leaves the old one out of every ceiling. A timer of the composition root calls it;
   * the rescue address operations call it too.
   */
  readonly settle: (options: { readonly signal: AbortSignal }) => Promise<void>;
}

/** The ports and adapters the composition root builds the engine from. */
export interface EngineOptions {
  readonly stores: EngineStores;
  /** Executions, arrivals and positions, live and paper; the paper portfolio lives here. */
  readonly positions: PositionStore;
  /** Custody: the agent wallets' accounts, and later their signatures. */
  readonly custody: Signer;
  /** Custody's ceilings, which the owner key changes. */
  readonly ceilings: CeilingEditor;
  readonly prices: PriceSource;
  /** The wallets' live facts; a paper intent's balance comes from the paper portfolio. */
  readonly wallets: WalletFactsSource;
  /** The venue host over every venue the engine may use. */
  readonly host: VenueHost;
  /** Weighs the token each trade buys (`createRiskCheck` in `@binference/engine/risk`). */
  readonly risk: RiskCheck;
  readonly simulator: Simulator;
  /** Runs a rescue's sends unsent on its chain, live balances only. */
  readonly chainSimulator: TxSimulator;
  /** Takes each confirmed live intent onto its wallet's queue; it never sees a paper intent. */
  readonly executor: Executor;
  /** A paper reset's starting balances when it names none: 1 BNB and 500 USDT by default. */
  readonly paperBalances: readonly Amount[];
  /**
   * Whether the engine is locked: the unlock mode has not given it the agent key (spec 5, section
   * 3). While it is, a Confirm of a live intent fails with `engine.locked` and auto mode leaves
   * live intents to the owner; reads, paper intents and Cancel work as ever.
   */
  readonly isLocked: () => boolean;
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
    clock: options.clock,
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
    install: stores.install,
    custody: options.custody,
    chains,
  });
  return { ...portfolio, ...modes, ...wallets };
}

// A re-quote at a tap weighs every venue as the money path does, on the paper balances.
function requoteOptions(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly paper: PaperParts },
): VenueQuoteSourceOptions {
  const { custody, host, chains, clock, prices } = options;
  const { wallets, simulator } = parts.paper;
  return { stored: parts.stored, custody, wallets, host, simulator, prices, chains, clock };
}

// A confirmed paper intent fills in the paper portfolio, an unfreeze is written, and any other live
// one goes to the executor.
function executeOf(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly paper: PaperParts },
): ExecuteConfirmed {
  const { stored, paper } = parts;
  const { prices, clock, executor, publish, ids, stores } = options;
  const fills = createPaperFills({ stored, positions: paper.positions, prices, clock });
  const written = { stored, agents: stores.agents, intents: stores.intents, clock, ids, publish };
  return createExecuteConfirmed({
    paper: fills,
    executor,
    publish,
    unfreeze: async (snapshot, call) => writeUnfreeze(written, snapshot, call.signal),
  });
}

function intentParts(
  options: EngineOptions,
  paper: PaperParts,
): {
  readonly handlers: IntentHandlers;
  readonly answer: AnswerCard;
  readonly stored: StoredIntents;
} {
  const { stores, custody, host, chains, clock, ids } = options;
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids,
    random: options.random,
    publish: options.publish,
  });
  const execute = executeOf(options, { stored, paper });
  const confirmations = createConfirmations({
    clock,
    store: stored,
    quotes: createVenueQuoteSource(requoteOptions(options, { stored, paper })),
    simulator: paper.simulator,
  });
  const { isLocked } = options;
  const answer = createAnswerCard({ confirmations, stored, execute, isLocked });
  const moneyPath = createMoneyPath({
    stored,
    agents: stores.agents,
    custody,
    wallets: paper.wallets,
    policy: createPolicyCheck({ prices: options.prices, clock }),
    prices: options.prices,
    host,
    risk: options.risk,
    simulator: paper.simulator,
    chains,
    execute,
    isLocked: options.isLocked,
    lowGas: createLowGasAlerts({ publish: options.publish }),
    clock,
    ids,
  });
  return {
    answer,
    stored,
    handlers: createIntentHandlers({ stored, moneyPath, answer, chains }),
  };
}

// The freeze, the safety status and the rescue, which reads every wallet's live balances, never
// paper ones (decision 0100).
function safetyHandlers(options: EngineOptions, stored: StoredIntents): SafetyHandlers {
  const { stores, clock } = options;
  const { agents, intents, install } = stores;
  return createSafetyHandlers({
    ...options,
    stored,
    intents,
    agents,
    install,
    simulator: options.chainSimulator,
    policy: createPolicyCheck({ prices: options.prices, clock }),
  });
}

/**
 * Creates the {@link Engine}. Every write of an intent goes through one writer, which pushes
 * `intent`, card and `ledger` events as each write lands. A confirmed paper intent fills at its
 * confirmed quote in the paper portfolio; a confirmed live one goes to the executor.
 */
export function createEngine(given: EngineOptions): Engine {
  // Every part reads an agent's limits as they are in effect now (decision 0111).
  const agents = withLimitsInEffect(given.stores.agents, given.clock);
  const options = { ...given, stores: { ...given.stores, agents } };
  const paper = paperParts(options);
  const intents = intentParts(options, paper);
  const rescueParts = {
    install: options.stores.install,
    agents: options.stores.agents,
    ceilings: options.ceilings,
    clock: options.clock,
    publish: options.publish,
  };
  const settingsParts = {
    agents: options.stores.agents,
    journal: options.stores.configJournal,
    clock: options.clock,
    publish: options.publish,
  };
  return {
    handlers: {
      ...intents.handlers,
      ...createLedgerHandlers(options.stores.ledger),
      ...createConfigHistoryHandlers(options.stores.configJournal),
      ...settingsHandlers(options, paper),
      ...createApprovalHandlers(settingsParts),
      ...createLimitHandlers({
        ...settingsParts,
        install: options.stores.install,
        chains: options.chains,
      }),
      ...createSendLevelHandlers(settingsParts),
      ...createAddressBookHandlers(settingsParts),
      ...createRescueAddressHandlers({
        ...rescueParts,
        journal: settingsParts.journal,
        chains: options.chains,
      }),
      ...safetyHandlers(options, intents.stored),
    },
    answer: intents.answer,
    settle: async ({ signal }) => settleRescueCeilings(rescueParts, signal),
  };
}
