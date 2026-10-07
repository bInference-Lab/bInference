import type { AssetRef, ChainRef, SimulationOptions } from "@binference/chain";
import type { Id, Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { DeviceRecord } from "./access/device-record.js";
import type { PairCodeRecord, PairCodeUse } from "./access/pair-code-record.js";
import type { TokenRecord } from "./access/token-record.js";
import type {
  AgentDraft,
  AgentModeChange,
  AgentRecord,
  AgentSettings,
} from "./agents/agent-record.js";
import type { ApprovalModeChange, ApprovalModeRecord } from "./agents/approval-mode-record.js";
import type { LimitsChange, LimitsRecord } from "./agents/limits-record.js";
import type { ConfigChange, ConfigJournalEntry } from "./audit/config-change.js";
import type { ModelCharge } from "./billing/model-charge.js";
import type { BuiltQuote, IntentWrite, StoredIntent } from "./confirmations/stored-intent.js";
import type { BotUpdate } from "./ingress/bot-update.js";
import type {
  IdempotencyEntry,
  IdempotencyLookup,
  IdempotencyRecall,
} from "./ingress/idempotency-entry.js";
import type { InboxAdmission, InboxDraft, InboxEntry } from "./ingress/inbox-entry.js";
import type { InstallFacts, InstallIdProposal, InstallSetup } from "./install/install-record.js";
import type { CardRecord } from "./intents/card-record.js";
import type { StoredConfirmation } from "./intents/confirmation-record.js";
import type {
  IntentChange,
  IntentCommit,
  IntentEventRecord,
  IntentQuery,
} from "./intents/intent-change.js";
import type { QuoteFailure, SimulationFailure } from "./intents/intent-reason.js";
import type { IntentDraft, IntentRecord } from "./intents/intent-record.js";
import type { LedgerDraft, LedgerEntry } from "./ledger/ledger-entry.js";
import type { BlockReading, PriceReading } from "./market/market-reading.js";
import type { WalletFacts, WalletFactsQuery } from "./money-path/wallet-facts.js";
import type { ArrivalRecord, ArrivalWrite, PaperReset } from "./positions/arrival-record.js";
import type { ExecutionQuery, ExecutionRecord } from "./positions/execution-record.js";
import type { ExecutionWrite, PositionQuery, PositionRecord } from "./positions/position-record.js";
import type { RowPage } from "./records/row-page.js";
import type { Sha256Hex } from "./records/sha256-hex.js";
import type { StampedId } from "./records/stamped-id.js";
import type { NonceGrant, NonceRequest } from "./wallet-queue/nonce-grant.js";
import type {
  SignedTransaction,
  TransactionQuery,
  TransactionRecord,
} from "./wallet-queue/transaction-record.js";

/**
 * Streams the blocks and prices the watchers read (ARCHITECTURE.md section 9). A stream sees each
 * reading from the moment the call returns, yields them in order, and rejects with the signal's
 * reason once the signal aborts. Adapters: watchers that read each block and the pools' state over
 * the chain's RPC, and a market-data service that shares one reading among every agent watching.
 */
export interface MarketData {
  /** The chain's new blocks. */
  blocks(chain: ChainRef, options: { readonly signal: AbortSignal }): AsyncIterable<BlockReading>;
  /** The asset's USD price, each time it is read. */
  prices(asset: AssetRef, options: { readonly signal: AbortSignal }): AsyncIterable<PriceReading>;
}

/**
 * Keeps the intents the owner answers, and decides which answer comes first (spec 6, section 9).
 * A write lands only while the intent's row still has the version the write read, in one
 * transaction with its event, its card's closing, its confirmation and its re-quote.
 */
export interface ConfirmationStore {
  /** The intent with its row version and card rules, or `undefined` for an unknown id. */
  read(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<StoredIntent | undefined>;
  /**
   * Stores one transition and answers the intent as it now stands. A row that moved past the
   * version the write read, an unknown intent, or a second confirmation for one intent changes
   * nothing and answers `stale`.
   */
  write(
    write: IntentWrite,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<StoredIntent, "stale">>;
}

/**
 * Quotes an intent's request again when the owner taps a card whose quote is old, and builds its
 * steps from the new quote. The steps' decode matches the request, as at the first quote.
 */
export interface QuoteSource {
  /** A new quote with its steps, or why there is none. Rejects once the signal aborts. */
  requote(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<BuiltQuote, QuoteFailure>>;
}

/**
 * Simulates the steps a quote built for an intent. The balance changes must match the request,
 * with no other outflow or approval.
 */
export interface Simulator {
  /**
   * The wallet's balance changes, or why the steps fail. The options' balances, such as a paper
   * intent's, replace what the wallet holds on the chain for this run. Rejects once the signal
   * aborts.
   */
  simulate(
    intent: Id<"int">,
    built: BuiltQuote,
    options: SimulationOptions,
  ): Promise<Result<SimulationView, SimulationFailure>>;
}

/**
 * What every store call takes. A call on an aborted signal rejects with the signal's reason and
 * changes nothing.
 */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps intents with their events, card versions and confirmations (database spec, section 2.3).
 * It is the one writer of an intent's state: the state machine decides, and this store writes each
 * move all or nothing, together with its ledger entry.
 */
export interface IntentStore {
  /** Writes a new intent with its first event and ledger entry; an id in use is `exists`. */
  create(draft: IntentDraft, options: StoreCall): Promise<Result<IntentCommit, "exists">>;
  /** One intent, or `undefined` when the store has none with that id. */
  get(id: Id<"int">, options: StoreCall): Promise<IntentRecord | undefined>;
  /**
   * Moves an intent when its stored version is `expectedVersion`, then raises the version by one.
   * Another version is `stale` and writes nothing, so of two racing moves the first wins. A card
   * that is not this intent's open version, or a second confirmation, throws and writes nothing.
   */
  transition(
    change: IntentChange,
    options: StoreCall,
  ): Promise<Result<IntentCommit, "not_found" | "stale">>;
  /** Intents in the query's states, the least recently changed first. */
  list(query: IntentQuery, options: StoreCall): Promise<readonly IntentRecord[]>;
  /** An intent's events, oldest first. */
  events(id: Id<"int">, options: StoreCall): Promise<readonly IntentEventRecord[]>;
  /** An intent's card versions, oldest first. */
  cards(id: Id<"int">, options: StoreCall): Promise<readonly CardRecord[]>;
  /** An intent's confirmation, if the owner confirmed it. */
  confirmation(id: Id<"int">, options: StoreCall): Promise<StoredConfirmation | undefined>;
  /**
   * The card version whose buttons carry this callback reference, open or closed, or `undefined`
   * when no card version has it.
   */
  cardByRef(callbackRef: string, options: StoreCall): Promise<CardRecord | undefined>;
}

/**
 * The append-only, hash-chained ledger (database spec, section 2.5). Nothing updates or deletes
 * an entry. The intent store appends the entries of intent moves; this port appends the others.
 */
export interface LedgerStore {
  /**
   * Places a draft at the end of the chain and returns it with its `seq` and hashes. An id in use
   * throws `store.constraint` and appends nothing.
   */
  append(draft: LedgerDraft, options: StoreCall): Promise<LedgerEntry>;
  /** Entries with a `seq` after `page.after`, in order, at most `page.limit`. */
  list(page: RowPage, options: StoreCall): Promise<readonly LedgerEntry[]>;
  /** The newest entry, or `undefined` for an empty ledger. */
  last(options: StoreCall): Promise<LedgerEntry | undefined>;
}

/**
 * Keeps executions, arrivals and the positions they move (database spec, section 2.3). An
 * execution or an arrival is stored with its position changes in one transaction, each under the
 * row version it was computed from, so two changes that race on a position cannot both land.
 */
export interface PositionStore {
  /** One wallet's positions, paper or live, ordered by asset. */
  positions(query: PositionQuery, options: StoreCall): Promise<readonly PositionRecord[]>;
  /**
   * Stores an execution and its position writes, and returns the execution with its number. A
   * position whose row is not at the write's `readVersion`, or a new position whose row exists,
   * is `stale` and stores nothing. Two writes to one position throw `store.constraint`.
   */
  record(write: ExecutionWrite, options: StoreCall): Promise<Result<ExecutionRecord, "stale">>;
  /** Executions that match the query, in the order recorded. */
  executions(query: ExecutionQuery, options: StoreCall): Promise<readonly ExecutionRecord[]>;
  /**
   * Stores an arrival and its position writes under the same rules as `record`, and returns the
   * arrival with its number. Arrivals are numbered apart from executions.
   */
  recordArrival(write: ArrivalWrite, options: StoreCall): Promise<Result<ArrivalRecord, "stale">>;
  /** Arrivals that match the query, in the order recorded. */
  arrivals(query: ExecutionQuery, options: StoreCall): Promise<readonly ArrivalRecord[]>;
  /**
   * Starts a wallet's paper portfolio again: stores the reset's arrivals and position writes all
   * or nothing, under the same rules as `record`, and returns the arrivals with their numbers. A
   * paper position of the wallet that the reset does not write moved since the reset read the
   * positions, so the reset is `stale` and stores nothing. An arrival or a position that is not a
   * paper one of the reset's wallet throws `store.constraint`.
   */
  resetPaper(
    reset: PaperReset,
    options: StoreCall,
  ): Promise<Result<readonly ArrivalRecord[], "stale">>;
}

/**
 * Keeps each wallet's transactions and the nonces they hold (database spec, `txs` and `nonces`).
 * The wallet queue is its one writer of nonces: one account's calls come one at a time, from the
 * account's queue.
 */
export interface TransactionStore {
  /**
   * Gives the account its next nonce by the lowest free nonce rule, from the account's stored
   * transactions and the chain's count, and records one past the highest nonce given. A nonce
   * counts as used only once a signed transaction holds it, so asking again before then gives the
   * same nonce.
   */
  nextNonce(request: NonceRequest, options: StoreCall): Promise<NonceGrant>;
  /**
   * Stores a signed transaction in `signed`, before any send. A nonce that is not free (a
   * `signed` or `sent` transaction of the account holds it, or a block holds it or a later nonce)
   * is `nonce_taken` and stores nothing. An id in use throws `store.constraint`.
   */
  saveSigned(
    transaction: SignedTransaction,
    options: StoreCall,
  ): Promise<Result<TransactionRecord, "nonce_taken">>;
  /** One account's transactions from a nonce up, by nonce, then by id. */
  list(query: TransactionQuery, options: StoreCall): Promise<readonly TransactionRecord[]>;
}

/** Keeps each write's result under its idempotency key (protocol spec, section 5). */
export interface IdempotencyStore {
  /** What the store holds under the key, compared with the args hash. */
  recall(lookup: IdempotencyLookup, options: StoreCall): Promise<IdempotencyRecall>;
  /**
   * Stores a result under its key when the key is free, and answers `new`. A key that holds a
   * result keeps the first one: `repeat` returns it, `reused` says the args differ.
   */
  remember(entry: IdempotencyEntry, options: StoreCall): Promise<IdempotencyRecall>;
  /** Deletes results stored before `beforeMs` and returns how many. */
  prune(beforeMs: number, options: StoreCall): Promise<number>;
}

/** Keeps every inbound Telegram update and webhook call from before it is acknowledged. */
export interface InboxStore {
  /** Stores an event; a source key stored before is a `repeat` that returns the first entry. */
  admit(draft: InboxDraft, options: StoreCall): Promise<InboxAdmission>;
  /** Marks an entry handled; the first mark wins and a later one is `handled`. */
  markHandled(
    mark: { readonly id: number; readonly atMs: number },
    options: StoreCall,
  ): Promise<Result<InboxEntry, "not_found" | "handled">>;
  /** Entries not handled yet, oldest first, at most `limit`: the work a restart resumes. */
  unhandled(limit: number, options: StoreCall): Promise<readonly InboxEntry[]>;
  /** Deletes entries handled before `beforeMs` and returns how many. */
  prune(beforeMs: number, options: StoreCall): Promise<number>;
}

/**
 * A chat bot's inbound updates, before the engine stores them (ARCHITECTURE.md section 3). The
 * channel stores each update in the inbox and then acknowledges it, so an update the engine never
 * stored comes again. Adapters: long polling with the bot's token in `@binference/telegram`, and a
 * webhook relay that hands over the updates an ingress service received.
 */
export interface BotUpdateSource {
  /**
   * The updates after the last acknowledged one, in the order of their ids, at most `limit` (100
   * when absent). Waits while there are none, and answers an update again until it is
   * acknowledged. Rejects with the signal's reason once the signal aborts.
   */
  next(options: {
    readonly signal: AbortSignal;
    readonly limit?: number;
  }): Promise<readonly BotUpdate[]>;
  /** Acknowledges every update up to and including `updateId`: none of them comes again. */
  acknowledge(updateId: number, options: { readonly signal: AbortSignal }): Promise<void>;
}

/** Keeps client tokens, console devices and pairing codes: who may open the protocol. */
export interface AccessStore {
  /** Saves a new token; an id or secret hash in use is `exists`. */
  addToken(token: TokenRecord, options: StoreCall): Promise<Result<TokenRecord, "exists">>;
  /** The token whose secret has this SHA-256, revoked or not. */
  findToken(secretHash: Sha256Hex, options: StoreCall): Promise<TokenRecord | undefined>;
  /** Every token, oldest first. */
  listTokens(options: StoreCall): Promise<readonly TokenRecord[]>;
  /** Records a use; `lastUsedAtMs` only moves forward. */
  markTokenUsed(
    use: StampedId<"tok">,
    options: StoreCall,
  ): Promise<Result<TokenRecord, "not_found">>;
  /** Revokes a token; a second revoke keeps the first time. */
  revokeToken(
    revoke: StampedId<"tok">,
    options: StoreCall,
  ): Promise<Result<TokenRecord, "not_found">>;
  /** Saves a newly paired device; an id in use is `exists`. */
  addDevice(device: DeviceRecord, options: StoreCall): Promise<Result<DeviceRecord, "exists">>;
  /** One device, revoked or not. */
  findDevice(id: Id<"dev">, options: StoreCall): Promise<DeviceRecord | undefined>;
  /** Every device, oldest first. */
  listDevices(options: StoreCall): Promise<readonly DeviceRecord[]>;
  /** Records a successful proof; `lastSeenAtMs` only moves forward. */
  markDeviceSeen(
    seen: StampedId<"dev">,
    options: StoreCall,
  ): Promise<Result<DeviceRecord, "not_found">>;
  /** Revokes a device; a second revoke keeps the first time. */
  revokeDevice(
    revoke: StampedId<"dev">,
    options: StoreCall,
  ): Promise<Result<DeviceRecord, "not_found">>;
  /** Saves a new pairing code; a hash in use is `exists`. */
  addPairCode(code: PairCodeRecord, options: StoreCall): Promise<Result<PairCodeRecord, "exists">>;
  /** Uses a code once, before it expires. */
  usePairCode(
    use: PairCodeUse,
    options: StoreCall,
  ): Promise<Result<PairCodeRecord, "unknown" | "expired" | "used">>;
}

/** Keeps the agents and the settings the money path reads: their limits and approval modes. */
export interface AgentStore {
  /** Writes a new agent with its limits and approval mode; a taken id or name is refused. */
  create(
    draft: AgentDraft,
    options: StoreCall,
  ): Promise<Result<AgentSettings, "exists" | "name_taken">>;
  /** One agent with its settings. */
  get(id: Id<"agt">, options: StoreCall): Promise<AgentSettings | undefined>;
  /** Every agent, archived ones too, oldest first. */
  list(options: StoreCall): Promise<readonly AgentRecord[]>;
  /** Sets the approval mode under the version the changer read; another version is `stale`. */
  setApprovalMode(
    change: ApprovalModeChange,
    options: StoreCall,
  ): Promise<Result<ApprovalModeRecord, "not_found" | "stale">>;
  /** Sets the limits under the version the changer read; another version is `stale`. */
  setLimits(
    change: LimitsChange,
    options: StoreCall,
  ): Promise<Result<LimitsRecord, "not_found" | "stale">>;
  /**
   * Sets the agent's mode under the agent row's version the changer read, and raises that version
   * by one. Another version is `stale` and writes nothing.
   */
  setMode(
    change: AgentModeChange,
    options: StoreCall,
  ): Promise<Result<AgentRecord, "not_found" | "stale">>;
}

/**
 * Keeps the install's own facts (database spec, section 2.1): its id, its custody on Privy, the
 * rescue address, and the wallets `binference init` sets up for the first agent.
 */
export interface InstallStore {
  /**
   * The install's id. The first call stores the proposed id with the time the install began;
   * every later call answers that stored id and ignores the proposal.
   */
  installId(proposal: InstallIdProposal, options: StoreCall): Promise<Id<"ins">>;
  /** The custody, the rescue address and every wallet, archived ones too. */
  read(options: StoreCall): Promise<InstallFacts>;
  /**
   * Writes a setup in one transaction: the custody, the rescue address with any pending change
   * cleared, every earlier wallet archived, and the new wallet with its ceiling. An install that
   * holds a custody already is `set_up` and changes nothing, unless the setup starts over.
   */
  setUp(setup: InstallSetup, options: StoreCall): Promise<Result<void, "set_up">>;
}

/** The config journal: every config change, who made it and where, in the order recorded. */
export interface ConfigJournal {
  /** Records one change and returns it with its number. */
  record(change: ConfigChange, options: StoreCall): Promise<ConfigJournalEntry>;
  /** Entries numbered after `page.after`, in order, at most `page.limit`. */
  list(page: RowPage, options: StoreCall): Promise<readonly ConfigJournalEntry[]>;
}

/**
 * Pays for each agent's model calls and says what the agent may still spend (ARCHITECTURE.md
 * sections 26 and 30). Once nothing is left, chat waits; auto orders, watchers and webhook rules
 * keep running. Adapters: the daily model budget, with the owner's model key or bInference Router
 * link paying the provider, and a balance of bInference AI credit.
 */
export interface ModelBilling {
  /** What the agent may still spend on models, in micro-dollars; 0 once it is spent. */
  left(agent: Id<"agt">, options: { readonly signal: AbortSignal }): Promise<bigint>;
  /**
   * Charges one call's cost and answers what is left after it, never below 0. Rejects with the
   * signal's reason once the signal aborts, and charges nothing.
   */
  charge(charge: ModelCharge, options: { readonly signal: AbortSignal }): Promise<bigint>;
}

/**
 * The execute step for live intents (ARCHITECTURE.md section 7, step 8): it takes each confirmed
 * live intent onto its wallet's queue, which signs, stores and sends it. The engine hands it every
 * confirmed intent that is not a paper one, a rescue in paper mode too (decision 0100), and never
 * a paper intent (spec 6, invariant 3). Adapter: the executor over the wallet queue, the signer and
 * the relays.
 */
export interface Executor {
  /**
   * Takes a confirmed live intent and resolves once it holds it; the wallet queue moves the intent
   * on from `confirmed` later. Rejects with the signal's reason once the signal aborts, and takes
   * nothing.
   */
  take(intent: Id<"int">, options: { readonly signal: AbortSignal }): Promise<void>;
}

/**
 * What the money path reads about an agent's wallets beyond the store ports: which wallets the
 * agent owns, and the facts the policy and the auto test read about one of them now. Adapters: the
 * wallets table with the chain's RPC, the custody ceiling and the fee reader. For a paper intent
 * the engine takes the native balance from the paper portfolio instead.
 */
export interface WalletFactsSource {
  /** The agent's wallets, the one it uses by default first; none for an unknown agent. */
  wallets(
    agent: Id<"agt">,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly Id<"wal">[]>;
  /** The facts of one of the agent's wallets for an intent in the query's mode. */
  facts(query: WalletFactsQuery, options: { readonly signal: AbortSignal }): Promise<WalletFacts>;
}
