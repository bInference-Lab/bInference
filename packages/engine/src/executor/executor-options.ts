import type {
  ChainRef,
  ChainRegistry,
  NameResolver,
  PriceSource,
  ReceiptReader,
  RelaySender,
  Signer,
  TxPreparer,
  VenueDeclaration,
} from "@binference/chain";
import type { Clock, IdSource, Logger } from "@binference/core";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import type { PositionStore, WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
import type { StakingHost } from "../venues/staking-host.js";
import type { VenueHost } from "../venues/venue-host.js";
import type { WalletQueue } from "../wallet-queue/wallet-queue.js";
import type { ExecutorBridging } from "./bridge-queue-check.js";

/** The parts one chain's transactions go through: its preparer, its relays and its receipts. */
export interface ChainSending {
  readonly preparer: TxPreparer;
  readonly sender: RelaySender;
  readonly receipts: ReceiptReader;
}

/** How long the executor works on a step before it hands the step over. */
export interface ExecutorLimits {
  /** Sends of one transaction's stored bytes while no relay accepts them; 3 by default. */
  readonly sendAttempts: number;
  /**
   * Blocks with no receipt after which a step counts as stuck (spec 6, section 6): it is
   * simulated again, and sent again with the same bytes while it is still valid; 20.
   */
  readonly stuckAfterBlocks: number;
  /**
   * Blocks with no receipt after which a stuck step still valid is sped up, the same call at
   * least 10% dearer at its nonce (spec 6, section 6); 40.
   */
  readonly replaceAfterBlocks: number;
  /**
   * Blocks every relay refuses a stuck step's bytes before the step is dropped and its intent
   * ends, the step's nonce still free (decision 0115); 60, three times `stuckAfterBlocks`. A
   * step no rule can move waits as long before it is handed over.
   */
  readonly droppedAfterBlocks: number;
  /** Blocks after inclusion it waits for every step's block to be final; 600. */
  readonly finalAfterBlocks: number;
  /** Blocks reconciliation waits for what a final intent moved and the prices that value it; 20. */
  readonly settleAfterBlocks: number;
}

/**
 * What the executor reads, writes and sends through. The stores, the wallet facts and the prices
 * are the engine's own; the queue owns each wallet's nonces; custody signs; `sending` holds the
 * parts of each chain the executor sends on; reconciliation records each trade in `positions`.
 */
export interface ExecutorOptions {
  readonly stores: Pick<
    EngineStores,
    | "intents"
    | "agents"
    | "ledger"
    | "transactions"
    | "install"
    | "orders"
    | "bridges"
    | "unbondings"
  >;
  readonly positions: PositionStore;
  readonly queue: WalletQueue;
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly prices: PriceSource;
  readonly chains: ChainRegistry;
  /** The venues' declarations: the contracts the signer lets a trade's steps reach. */
  readonly venues: readonly VenueDeclaration[];
  /**
   * The launchpads' curve reads: the contracts of a launch a launch wallet's step may reach, read
   * again right before signing (decision 0217). Without them, no step reaches a launch contract.
   */
  readonly curves?: Pick<VenueHost, "curves">;
  /**
   * The name resolvers a send by name is read again through before it signs (decision 0308);
   * without one for its suffix, a send by name waits and never signs.
   */
  readonly nameResolvers?: readonly NameResolver[];
  /**
   * The bridges' declarations, the chains they deliver to and the code readers: what a confirmed
   * bridge is checked again and signed with (decisions 0317 and 0318). Without them, no bridge
   * signs.
   */
  readonly bridging?: ExecutorBridging;
  /**
   * The staking venues, through their host: what a confirmed staking move is planned again with
   * before it signs, and its landed move read back with (decision 0327). Without it, no stake signs.
   */
  readonly staking?: StakingHost;
  /**
   * Each chain's sending parts. An intent run reads its chain's once, when it reads its plan, and
   * keeps them to its end: a settings reload reaches the runs that start after it (decision 0230).
   */
  readonly sending: Pick<ReadonlyMap<ChainRef, ChainSending>, "get">;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** Where the pushes of its intent moves and ledger entries go. */
  readonly publish: PublishPush;
  /**
   * Hears each settle message a move that ends a live intent stored for the agent runtime, after
   * the move's own pushes: the engine's `pushSettled`, so the runtime hears of it at once. Without
   * it the runtime reads the message only with `inbox/list`.
   */
  readonly settled?: (message: AgentInboxMessage) => void;
  readonly logger: Logger;
  readonly limits?: Partial<ExecutorLimits>;
  /**
   * Whether live order fills may sign; off when absent, so the queue ends each one unsigned while
   * live fills are off (decision 0211).
   */
  readonly liveOrderFills?: boolean;
}

/** The limits the executor runs with when its options leave them out. */
export const defaultExecutorLimits: ExecutorLimits = {
  sendAttempts: 3,
  stuckAfterBlocks: 20,
  replaceAfterBlocks: 40,
  droppedAfterBlocks: 60,
  finalAfterBlocks: 600,
  settleAfterBlocks: 20,
};
