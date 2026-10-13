import type {
  ChainRef,
  ChainRegistry,
  PriceSource,
  ReceiptReader,
  RelaySender,
  Signer,
  TxPreparer,
  VenueDeclaration,
} from "@binference/chain";
import type { Clock, IdSource, Logger } from "@binference/core";
import type { PositionStore, WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
import type { VenueHost } from "../venues/venue-host.js";
import type { WalletQueue } from "../wallet-queue/wallet-queue.js";

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
    "intents" | "agents" | "ledger" | "transactions" | "install" | "orders"
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
  readonly sending: ReadonlyMap<ChainRef, ChainSending>;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** Where the pushes of its intent moves and ledger entries go. */
  readonly publish: PublishPush;
  readonly logger: Logger;
  readonly limits?: Partial<ExecutorLimits>;
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
