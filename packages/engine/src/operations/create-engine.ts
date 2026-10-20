import type {
  Amount,
  AssetRef,
  ChainRegistry,
  PriceSource,
  Signer,
  TxSimulator,
} from "@binference/chain";
import type { Clock, IdSource, Random, WorkspaceFiles } from "@binference/core";
import {
  type AddressBookHandlers,
  createAddressBookHandlers,
} from "../address-book/address-book-handlers.js";
import { withLimitsInEffect } from "../agents/limits-in-effect.js";
import type { AlertFiring } from "../alerts/fire-alerts.js";
import { type ApprovalHandlers, createApprovalHandlers } from "../approval/approval-handlers.js";
import {
  type ConfigHistoryHandlers,
  createConfigHistoryHandlers,
} from "../audit/config-history-handlers.js";
import type { ModelBudgetParts } from "../billing/model-budget.js";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import type { RunningTurns } from "../chat/running-turns.js";
import { createCapGate } from "../confirmations/cap-gate.js";
import type { CardTimerParts } from "../confirmations/card-timer.js";
import { createConfirmations } from "../confirmations/create-confirmations.js";
import { createDowntimeCheck, type DowntimeCheck } from "../downtime/downtime-check.js";
import type { Downtime } from "../downtime/downtime.js";
import type { HeldWallet } from "../executor/held-wallets.js";
import { createGasCheck } from "../gas/check-gas.js";
import { createLowGasAlerts, type LowGasAlerts } from "../gas/low-gas-alerts.js";
import type {
  CeilingEditor,
  SignerRevoker,
  WalletExporter,
  WalletMaker,
} from "../install/ports.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { LaunchDraftDesk } from "../launches/launch-draft-desk.js";
import { createLimitHandlers, type LimitHandlers } from "../limits/limit-handlers.js";
import type { MarketParts } from "../market/market-handlers.js";
import type { PinFollow } from "../money-path/follow-launch-pin.js";
import type { LaunchingMoneyPath } from "../money-path/launching-money-path.js";
import type { LaunchImageSource } from "../money-path/ports.js";
import type { ReadTokenCode } from "../money-path/token-code.js";
import { createVenueQuoteSource } from "../money-path/venue-quote-source.js";
import type { CopyOrders } from "../orders/copy-orders.js";
import type { CanPrice, OrderParts } from "../orders/create-order.js";
import { createDcaOrders, type DcaOrders } from "../orders/dca-orders.js";
import type { OrderFills } from "../orders/fill-orders.js";
import { createOrderHandlers, type OrderHandlers } from "../orders/order-handlers.js";
import { createOrderTriggers, type OrderTriggers } from "../orders/order-triggers.js";
import { createPaperParts, type PaperParts } from "../paper/paper-parts.js";
import type { Executor, PositionStore, RiskCheck, Simulator, WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
import {
  createRescueAddressHandlers,
  type RescueAddressHandlers,
} from "../safety/rescue-address-handlers.js";
import { settleRescueCeilings } from "../safety/rescue-ceilings.js";
import type { SafetyHandlers } from "../safety/safety-handlers.js";
import {
  createSendLevelHandlers,
  type SendLevelHandlers,
} from "../send-levels/send-level-handlers.js";
import type { DailySummaries } from "../summaries/daily-summaries.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import type { ImageOptions } from "../uploads/image-options.js";
import type { LaunchHost } from "../venues/launch-host.js";
import type { VenueHost } from "../venues/venue-host.js";
import { type AnswerCard, createAnswerCard } from "./answer-card.js";
import {
  executeOf,
  launchRoutingOf,
  requoteOptions,
  storedIntentsOf,
} from "./engine-intent-parts.js";
import {
  launchDraftsOf,
  type LaunchDraftHandlers,
  withSharedParts,
} from "./engine-launch-drafts.js";
import { moneyPathOf } from "./engine-money-path.js";
import { cardTimerOf, copyOrdersOf, orderFillsOf, orderPartsOf } from "./engine-orders.js";
import { type EngineChatHandlers, engineChatOf, safetyHandlersOf } from "./engine-parts.js";
import { startupWorkOf } from "./engine-repairs.js";
import { dailySummariesOf } from "./engine-summaries.js";
import { timedWorkOf } from "./engine-timers.js";
import { createIntentHandlers, type IntentHandlers } from "./intent-handlers.js";
import { createLedgerHandlers, type LedgerHandlers } from "./ledger-handlers.js";
import { type SettingsHandlers, settingsHandlers } from "./settings-handlers.js";

/** The operation handlers the engine gives the protocol server, by operation name. */
export interface EngineHandlers
  extends
    EngineChatHandlers,
    IntentHandlers,
    OrderHandlers,
    LedgerHandlers,
    ConfigHistoryHandlers,
    SettingsHandlers,
    ApprovalHandlers,
    LimitHandlers,
    SendLevelHandlers,
    AddressBookHandlers,
    RescueAddressHandlers,
    SafetyHandlers,
    LaunchDraftHandlers {}

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
   * The agent's open launch drafts (decision 0285): what the owner's surfaces show of each, and
   * the owner's Start or Drop, which only a press of the owner's own reaches.
   */
  readonly launchDrafts: LaunchDraftDesk;
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
  /**
   * Cancels, unsigned, each paper fill of an auto order a stop left unfinished, and tells the
   * owner every fill notice a stop kept from being announced (decision 0197). The startup calls it
   * before any price can fire an order; it answers how many intents and rows it repaired.
   */
  readonly repairOrderFills: (options: { readonly signal: AbortSignal }) => Promise<number>;
  /**
   * The auto order and alert work that waits for no price (decision 0189): each order waiting for
   * its card moves as the card says, each order whose expiry came expires, each order that ends
   * within 24 hours gets its one `notice.orderExpiring`, and each alert whose expiry came ends. A
   * timer of the composition root calls it every 10 seconds; an answer moves its own order at once.
   */
  readonly tickOrders: (options: { readonly signal: AbortSignal }) => Promise<void>;
  /**
   * The card timer (spec 6, section 3): closes as expired every card waiting for the owner whose
   * time is up, an auto order's card with its order, and answers when the next open card's time
   * is up, or `undefined` when no card waits. It also ends every launch draft whose 10 minutes
   * ran out (decision 0285), and counts the next draft's end as the next time. A timer of the
   * composition root calls it again at that time, locked or not: it signs nothing.
   */
  readonly expireCards: (options: { readonly signal: AbortSignal }) => Promise<number | undefined>;
  /**
   * Runs each schedule whose time came, once however many runs it missed (decision 0232), then
   * each DCA order's period that came: one buy for a period on time, a `missed` skip for one that
   * came while the order could not buy (decision 0246). A timer of the composition root calls it
   * while the engine is unlocked.
   */
  readonly runSchedules: (options: { readonly signal: AbortSignal }) => Promise<void>;
  /**
   * Copies, for each active copy order, its leader's trades the leader watcher stored since the
   * last one it took, each once, through the order fills (decision 0260). A timer of the
   * composition root calls it every second, locked or not: a locked engine's fills skip.
   */
  readonly runCopies: CopyOrders["run"];
  /**
   * Judges the active limit, take-profit, stop-loss and trailing orders on a confirmed price of
   * their token, and fills those it triggers in the same block's processing (decision 0196). The
   * price watchers call it with each price; it answers once the fills it started ended.
   */
  readonly seePrice: OrderTriggers["see"];
  /**
   * The downtime re-check (decisions 0266 to 0268): the composition root tells it of the start
   * and of each wake from sleep, and marks the engine alive each minute; it re-checks every auto
   * order once and sends one report.
   */
  readonly downtime: Downtime;
  /**
   * Asks the launchpad of each live token launch waiting in `quoted` whether it pinned the
   * launch's words and picture (decision 0234): a pinned launch goes on to its card, a failed pin
   * or the end of the pin wait ends it with a notice. It also ends, with a notice, each launch a
   * fault or a stop cut short after its upload (decision 0237). A timer of the composition root
   * calls it every 3 seconds, locked or not: it signs nothing. The startup calls it once first
   * with `isRepair`, which ends every launch left in `checked` at once. Answers how many launches
   * it moved.
   */
  readonly checkPins: (options: PinFollow) => Promise<number>;
  /**
   * The alert firing (protocol spec, section 8.4): the price watchers hand it each confirmed
   * price, as they hand `seePrice`; the leader watcher each trade of a tracked wallet; the launch
   * feed each new launch. It notifies and may wake the agent, and never reaches the money path.
   */
  readonly alerts: AlertFiring;
  /**
   * Sends each agent's daily summary whose time came today, once per owner's date across a
   * restart (decision 0273). A timer of the composition root calls it every minute, locked or not:
   * it only reads and tells.
   */
  readonly sendDailySummaries: DailySummaries["run"];
}

/** The ports and adapters the composition root builds the engine from. */
export interface EngineOptions extends MarketParts, ModelBudgetParts, ImageOptions {
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
  /**
   * Whether the price watcher can price a token now; `order/create` refuses a limit, take-profit,
   * stop-loss or trailing order for a token it cannot (`order.unpriced_token`, decision 0194).
   */
  readonly canPrice: CanPrice;
  /** What a token the registry does not list answers on chain, for its cards (decision 0199). */
  readonly readTokenFacts: OrderParts["readTokenFacts"];
  /** Each agent's workspace files, which `agent/readFile` and `agent/writeFile` serve. */
  readonly workspace: WorkspaceFiles;
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
  /**
   * Whether a live auto order may fill. Off when absent, and no config sets it: live fills wait
   * for the crash suite on fills (decision 0195), so a live order skips with `live_fills_off`.
   */
  readonly liveOrderFills?: boolean;
  /**
   * Each chain's coin, the tokens that wrap it and the stablecoins with a feed: what a leader's
   * trade spends or gets, so a copy order never buys one (decision 0260). The coins alone when absent.
   */
  readonly quoteAssets?: ReadonlySet<AssetRef>;
  /** The launch side of the venue host; without it no token launch is proposed (decision 0234). */
  readonly launchHost?: LaunchHost;
  /**
   * Reads whether a launch's token holds code yet; without it no token launch is proposed, since
   * none could prove its token new (decision 0238).
   */
  readonly launchTokenCode?: ReadTokenCode;
  /** The owner's uploads, which a token launch's picture comes from; none are readable without. */
  readonly launchImages?: LaunchImageSource;
  /** The wallets the executor's stuck steps hold now, which the daily summary counts; none without. */
  readonly heldWallets?: () => readonly HeldWallet[];
}

/** The intent and order parts of the engine. */
interface IntentParts {
  readonly handlers: IntentHandlers & OrderHandlers;
  readonly answer: AnswerCard;
  readonly stored: StoredIntents;
  readonly orders: OrderParts;
  readonly fills: OrderFills;
  readonly triggers: OrderTriggers;
  /** The DCA orders' periods, which the schedule queue's timer runs (decision 0246). */
  readonly dca: DcaOrders;
  /** The copy orders' leader trades, which the copy timer runs (decision 0260). */
  readonly copies: CopyOrders;
  /** One alert for the money path and the gas check, so each drop is announced once. */
  readonly lowGas: LowGasAlerts;
  readonly cardTimer: CardTimerParts;
  readonly moneyPath: LaunchingMoneyPath;
}

function intentParts(
  options: EngineOptions,
  paper: PaperParts,
  parts: {
    readonly settled: (message: AgentInboxMessage) => void;
    readonly check: DowntimeCheck;
  },
): IntentParts {
  const { settled, check } = parts;
  const { stores, host, chains, clock, isLocked } = options;
  const gate = createCapGate({ intents: stores.intents, clock });
  const stored = storedIntentsOf(options, { settled, gate });
  const confirmations = createConfirmations({
    clock,
    store: stored,
    quotes: createVenueQuoteSource(requoteOptions(options, { stored, paper })),
    simulator: paper.simulator,
  });
  const launches = launchRoutingOf(options, paper);
  const orders = orderPartsOf(options, { stored, confirmations, wallets: paper.wallets, launches });
  const execute = executeOf(options, { stored, paper, orders });
  const lowGas = createLowGasAlerts({ publish: options.publish });
  const answer = createAnswerCard({ confirmations, stored, execute, isLocked, gate });
  const showings = createCardShowings({ ...stores, chains, venues: host, isLocked });
  const moneyPath = moneyPathOf(options, { stored, paper, launches, execute, lowGas, gate });
  const handlers = {
    ...createIntentHandlers({ stored, moneyPath, answer, chains, showings }),
    ...createOrderHandlers(orders),
  };
  const cardTimer = cardTimerOf(options, { confirmations, orders });
  const fillParts = { stored, moneyPath, gate, holdings: paper.holdings, fence: check };
  const fills = orderFillsOf(options, fillParts);
  const triggers = createOrderTriggers({ orders: stores.orders, fills, clock, fence: check });
  const dca = createDcaOrders({
    orders: stores.orders,
    fills,
    chains,
    intents: stores.intents,
    clock,
    publish: options.publish,
  });
  const copies = copyOrdersOf(options, fills);
  const timed = { triggers, dca, copies };
  return { answer, stored, orders, fills, ...timed, handlers, lowGas, cardTimer, moneyPath };
}

// What the rescue address, the address book and the settings operations each read and push.
function sharedParts(options: EngineOptions) {
  const { stores, ceilings, chains, clock, publish } = options;
  return {
    rescueParts: {
      install: stores.install,
      agents: stores.agents,
      ceilings,
      chains,
      clock,
      publish,
    },
    settingsParts: { agents: stores.agents, journal: stores.configJournal, clock, publish },
  };
}

// The settings the owner changes: the agent's settings, its approval mode, limits and send level,
// the address book and the rescue address.
function ownerSettingsHandlers(options: EngineOptions, paper: PaperParts) {
  const { rescueParts, settingsParts } = sharedParts(options);
  const { journal } = settingsParts;
  return {
    ...settingsHandlers(options, paper),
    ...createApprovalHandlers(settingsParts),
    ...createLimitHandlers({
      ...settingsParts,
      install: options.stores.install,
      host: options.host,
      chains: options.chains,
    }),
    ...createSendLevelHandlers(settingsParts),
    ...createAddressBookHandlers({ ...rescueParts, journal, ids: options.ids }),
    ...createRescueAddressHandlers({ ...rescueParts, journal }),
  };
}

/**
 * Creates the {@link Engine}. Every write of an intent goes through one writer, which pushes
 * `intent`, card and `ledger` events as each write lands. A confirmed paper intent fills at its
 * confirmed quote in the paper portfolio; a confirmed live one goes to the executor.
 */
export function createEngine(given: EngineOptions): Engine {
  return createEngineWithFills(given).engine;
}

/**
 * Creates the {@link Engine} and, apart from it, its order fills (decision 0195), which only its
 * price triggers start: a test runs a fill at a price of its choice through them, never through the
 * engine's own surface (decision 0197).
 */
export function createEngineWithFills(given: EngineOptions): {
  readonly engine: Engine;
  readonly fillOrder: OrderFills["run"];
} {
  // Every part reads an agent's limits as they are in effect now (decision 0111).
  const agents = withLimitsInEffect(given.stores.agents, given.clock);
  const options = withSharedParts({ ...given, stores: { ...given.stores, agents } });
  const paper = createPaperParts(options);
  const chat = engineChatOf(options);
  const check = createDowntimeCheck();
  const intents = intentParts(options, paper, { settled: chat.settled, check });
  chat.attach(intents.stored);
  const { rescueParts } = sharedParts(options);
  const summaries = dailySummariesOf(options, paper);
  const drafts = launchDraftsOf(options, intents);
  const engine: Engine = {
    handlers: {
      ...intents.handlers,
      ...createLedgerHandlers(options.stores.ledger),
      ...createConfigHistoryHandlers(options.stores.configJournal),
      ...ownerSettingsHandlers(options, paper),
      ...safetyHandlersOf(options, { stored: intents.stored, relay: chat.relay }),
      ...chat.handlers,
      ...drafts.handlers,
    },
    answer: intents.answer,
    launchDrafts: drafts.desk,
    settle: async ({ signal }) => settleRescueCeilings(rescueParts, signal),
    checkGas: createGasCheck({ ...options, ...options.stores, lowGas: intents.lowGas }),
    ...startupWorkOf(options, { ...intents, relay: chat.relay, check, paper }),
    ...timedWorkOf({ intents, chat, drafts: drafts.desk, clock: options.clock }),
    seePrice: async (price, call) => intents.triggers.see(price, call),
    checkPins: async (call) => intents.moneyPath.followPins(call),
    alerts: chat.alerts,
    sendDailySummaries: async (call) => summaries.run(call),
  };
  return { engine, fillOrder: async (request, call) => intents.fills.run(request, call) };
}
