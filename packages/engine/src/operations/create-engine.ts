import type { ChainRegistry, Signer } from "@binference/chain";
import type { Clock, IdSource } from "@binference/core";
import { createConfirmations } from "../confirmations/create-confirmations.js";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import { createMoneyPath } from "../money-path/create-money-path.js";
import { createVenueQuoteSource } from "../money-path/venue-quote-source.js";
import { createPaperFills } from "../paper/paper-fills.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { PriceSource, Simulator, WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
import type { VenueHost } from "../venues/venue-host.js";
import { type AnswerCard, createAnswerCard } from "./answer-card.js";
import { createIntentHandlers, type IntentHandlers } from "./intent-handlers.js";
import { createLedgerHandlers, type LedgerHandlers } from "./ledger-handlers.js";

/** The operation handlers the engine gives the protocol server, by operation name. */
export interface EngineHandlers extends IntentHandlers, LedgerHandlers {}

/**
 * The engine's use cases behind the protocol: the money path, confirmations, paper fills and the
 * ledger, built from ports. It holds no I/O of its own; pushes leave through `publish`.
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
  /** Custody: the agent wallets' accounts, and later their signatures. */
  readonly custody: Signer;
  readonly prices: PriceSource;
  readonly wallets: WalletFactsSource;
  /** The venue host over every venue the engine may use. */
  readonly host: VenueHost;
  readonly simulator: Simulator;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** Where pushes go: the protocol server, which numbers them with a `seq` per topic. */
  readonly publish: PublishPush;
}

/**
 * Creates the {@link Engine}. Every write of an intent goes through one writer, which pushes
 * `intent`, card and `ledger` events as each write lands.
 */
export function createEngine(options: EngineOptions): Engine {
  const { stores, custody, host, chains, clock, ids } = options;
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids,
    publish: options.publish,
  });
  const paper = createPaperFills({ stored, clock });
  const confirmations = createConfirmations({
    clock,
    store: stored,
    quotes: createVenueQuoteSource({ stored, custody, host, chains }),
    simulator: options.simulator,
  });
  const answer = createAnswerCard({ confirmations, stored, paper });
  const moneyPath = createMoneyPath({
    stored,
    agents: stores.agents,
    custody,
    wallets: options.wallets,
    policy: createPolicyCheck({ prices: options.prices, clock }),
    host,
    simulator: options.simulator,
    chains,
    paper,
    clock,
    ids,
  });
  const intentHandlers = createIntentHandlers({ stored, moneyPath, answer, chains });
  return { handlers: { ...intentHandlers, ...createLedgerHandlers(stores.ledger) }, answer };
}
