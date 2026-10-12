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
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import type { ChatHandlers } from "../chat/chat-relay.js";
import type { RunningTurns } from "../chat/running-turns.js";
import { createCapGate } from "../confirmations/cap-gate.js";
import { createConfirmations } from "../confirmations/create-confirmations.js";
import { createGasCheck } from "../gas/check-gas.js";
import { createLowGasAlerts, type LowGasAlerts } from "../gas/low-gas-alerts.js";
import type {
  CeilingEditor,
  SignerRevoker,
  WalletExporter,
  WalletMaker,
} from "../install/ports.js";
import { createStoredIntents, type StoredIntents } from "../intents/create-stored-intents.js";
import { createLimitHandlers, type LimitHandlers } from "../limits/limit-handlers.js";
import { createMoneyPath } from "../money-path/create-money-path.js";
import { createExecuteConfirmed, type ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import {
  createVenueQuoteSource,
  type VenueQuoteSourceOptions,
} from "../money-path/venue-quote-source.js";
import { createPaperFills } from "../paper/paper-fills.js";
import { createPaperParts, type PaperParts } from "../paper/paper-parts.js";
import { repairPaperFills } from "../paper/repair-paper-fills.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { Executor, PositionStore, RiskCheck, Simulator, WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
import {
  createRescueAddressHandlers,
  type RescueAddressHandlers,
} from "../safety/rescue-address-handlers.js";
import { settleRescueCeilings } from "../safety/rescue-ceilings.js";
import type { SafetyHandlers } from "../safety/safety-handlers.js";
import { writeUnfreeze } from "../safety/write-unfreeze.js";
import {
  createSendLevelHandlers,
  type SendLevelHandlers,
} from "../send-levels/send-level-handlers.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import type { VenueHost } from "../venues/venue-host.js";
import { type AgentModeHandlers, createAgentModeHandlers } from "./agent-mode-handlers.js";
import { type AnswerCard, createAnswerCard } from "./answer-card.js";
import { type CeilingHandlers, createCeilingHandlers } from "./ceiling-handlers.js";
import { engineChatOf, safetyHandlersOf } from "./engine-parts.js";
import { createIntentHandlers, type IntentHandlers } from "./intent-handlers.js";
import { createLedgerHandlers, type LedgerHandlers } from "./ledger-handlers.js";
import { createPortfolioHandlers, type PortfolioHandlers } from "./portfolio-handlers.js";
import { createWalletHandlers, type WalletHandlers } from "./wallet-handlers.js";

/** The operation handlers the engine gives the protocol server, by operation name. */
export interface EngineHandlers
  extends
    ChatHandlers,
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
    WalletHandlers,
    CeilingHandlers {}

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
  /**
   * Reads the coin of every live agent's wallets and raises the low-gas alert the money path
   * raises, once per drop below twice the reserve (decision 0045). A timer of the composition root
   * calls it while the engine is unlocked. A read that fails is thrown once every wallet is read.
   */
  readonly checkGas: (options: { readonly signal: AbortSignal }) => Promise<void>;
  /**
   * Records the positions of each paper fill of the last 30 days that has none, which a crash
   * between a fill and its positions leaves, valued at the price the fill kept. The startup calls
   * it before the engine takes any work; it answers how many fills it repaired.
   */
  readonly repairPaperFills: (options: { readonly signal: AbortSignal }) => Promise<number>;
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
  /** Makes agent wallets in custody with the owner key. */
  readonly walletMaker: WalletMaker;
  /**
   * Custody's export of a wallet's key, sealed to the CLI's recipient key; none where custody
   * exports no key through the engine.
   */
  readonly exporter?: WalletExporter;
  /** Custody's removal of a machine's agent key; none where custody removes no signer here. */
  readonly revoker?: SignerRevoker;
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
  /**
   * The agent runtime's running turns and the token of its current start, which the supervisor
   * that starts the runtime keeps; an engine with no runtime has none started.
   */
  readonly turns?: RunningTurns;
}

function settingsHandlers(
  options: EngineOptions,
  paper: PaperParts,
): PortfolioHandlers & AgentModeHandlers & WalletHandlers & CeilingHandlers {
  const { stores, chains } = options;
  const portfolio = createPortfolioHandlers({
    agents: stores.agents,
    install: stores.install,
    portfolio: paper.portfolio,
    positions: paper.positions,
    store: options.positions,
    wallets: options.wallets,
    prices: options.prices,
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
    ceilings: options.ceilings,
    maker: options.walletMaker,
    ...(options.exporter === undefined ? {} : { exporter: options.exporter }),
    ...(options.revoker === undefined ? {} : { revoker: options.revoker }),
    journal: stores.configJournal,
    chains,
    clock: options.clock,
    ids: options.ids,
    publish: options.publish,
  });
  const ceilings = createCeilingHandlers({
    agents: stores.agents,
    install: stores.install,
    ceilings: options.ceilings,
    journal: stores.configJournal,
    chains,
    clock: options.clock,
    publish: options.publish,
  });
  return { ...portfolio, ...modes, ...wallets, ...ceilings };
}

// A re-quote at a tap weighs every venue as the money path does, on the paper balances.
function requoteOptions(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly paper: PaperParts },
): VenueQuoteSourceOptions {
  const { custody, host, chains, clock, prices } = options;
  const { stored, paper } = parts;
  const { wallets, simulator, holdings } = paper;
  return { stored, custody, wallets, holdings, host, simulator, prices, chains, clock };
}

// A confirmed paper intent fills in the paper portfolio, an unfreeze is written, and any other live
// one goes to the executor.
function executeOf(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly paper: PaperParts },
): ExecuteConfirmed {
  const {
    stored,
    paper: { positions, portfolio },
  } = parts;
  const { prices, clock, executor, publish, ids, stores } = options;
  const fills = createPaperFills({ stored, positions, portfolio, prices, clock });
  const written = { stored, agents: stores.agents, intents: stores.intents, clock, ids, publish };
  return createExecuteConfirmed({
    paper: fills,
    executor,
    publish,
    unfreeze: async (snapshot, call) => writeUnfreeze(written, snapshot, call.signal),
  });
}

// The one writer of intents, which tells the chat relay of each settle message it stores.
function storedIntentsOf(
  options: EngineOptions,
  settled: (message: AgentInboxMessage) => void,
): StoredIntents {
  const { stores, ids, random, publish } = options;
  const { intents, agents } = stores;
  return createStoredIntents({ intents, agents, ids, random, publish, settled });
}

function intentParts(
  options: EngineOptions,
  paper: PaperParts,
  settled: (message: AgentInboxMessage) => void,
): {
  readonly handlers: IntentHandlers;
  readonly answer: AnswerCard;
  readonly stored: StoredIntents;
  /** One alert for the money path and the gas check, so each drop is announced once. */
  readonly lowGas: LowGasAlerts;
} {
  const { stores, custody, host, chains, clock, ids, isLocked } = options;
  const stored = storedIntentsOf(options, settled);
  const execute = executeOf(options, { stored, paper });
  const confirmations = createConfirmations({
    clock,
    store: stored,
    quotes: createVenueQuoteSource(requoteOptions(options, { stored, paper })),
    simulator: paper.simulator,
  });
  const gate = createCapGate({ intents: stores.intents, clock });
  const lowGas = createLowGasAlerts({ publish: options.publish });
  const answer = createAnswerCard({ confirmations, stored, execute, isLocked, gate });
  const showings = createCardShowings({ intents: stores.intents, agents: stores.agents, chains });
  const moneyPath = createMoneyPath({
    stored,
    agents: stores.agents,
    custody,
    wallets: paper.wallets,
    holdings: paper.holdings,
    policy: createPolicyCheck({ prices: options.prices, clock }),
    prices: options.prices,
    host,
    risk: options.risk,
    simulator: paper.simulator,
    chains,
    execute,
    isLocked,
    lowGas,
    gate,
    clock,
    ids,
  });
  const handlers = createIntentHandlers({ stored, moneyPath, answer, chains, showings });
  return { answer, stored, handlers, lowGas };
}

// The startup's repair of paper fills a crash left without positions.
function paperRepairOf(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly paper: PaperParts },
): Engine["repairPaperFills"] {
  const repair = {
    intents: options.stores.intents,
    stored: parts.stored,
    store: options.positions,
    positions: parts.paper.positions,
    clock: options.clock,
  };
  return async (call) => repairPaperFills(repair, call);
}

// What the rescue address, the address book and the settings operations each read and push.
function sharedParts(options: EngineOptions) {
  const { stores, ceilings, clock, publish } = options;
  return {
    rescueParts: { install: stores.install, agents: stores.agents, ceilings, clock, publish },
    settingsParts: { agents: stores.agents, journal: stores.configJournal, clock, publish },
  };
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
  const paper = createPaperParts(options);
  const chat = engineChatOf(options);
  const intents = intentParts(options, paper, chat.settled);
  chat.attach(intents.stored);
  const { rescueParts, settingsParts } = sharedParts(options);
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
      ...createAddressBookHandlers({
        ...rescueParts,
        journal: settingsParts.journal,
        chains: options.chains,
        ids: options.ids,
      }),
      ...createRescueAddressHandlers({
        ...rescueParts,
        journal: settingsParts.journal,
        chains: options.chains,
      }),
      ...safetyHandlersOf(options, { stored: intents.stored, relay: chat.relay }),
      ...chat.relay.handlers,
    },
    answer: intents.answer,
    settle: async ({ signal }) => settleRescueCeilings(rescueParts, signal),
    checkGas: createGasCheck({ ...options, ...options.stores, lowGas: intents.lowGas }),
    repairPaperFills: paperRepairOf(options, { stored: intents.stored, paper }),
  };
}
