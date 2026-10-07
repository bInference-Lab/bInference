import type {
  ChainRef,
  ChainRegistry,
  PriceSource,
  ReceiptReader,
  RelaySender,
  Signer,
  TxPreparer,
} from "@binference/chain";
import type { Clock, IdSource, Logger } from "@binference/core";
import type { WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { EngineStores } from "../records/engine-stores.js";
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
  /** Blocks with no receipt after which a step counts as stuck (spec 6, section 6); 20. */
  readonly stuckAfterBlocks: number;
  /** Blocks after inclusion it waits for every step's block to be final; 600. */
  readonly finalAfterBlocks: number;
}

/**
 * What the executor reads, writes and sends through. The stores, the wallet facts and the prices
 * are the engine's own; the queue owns each wallet's nonces; custody signs; `sending` holds the
 * parts of each chain the executor sends on.
 */
export interface ExecutorOptions {
  readonly stores: Pick<EngineStores, "intents" | "agents" | "ledger" | "transactions">;
  readonly queue: WalletQueue;
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly prices: PriceSource;
  readonly chains: ChainRegistry;
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
  finalAfterBlocks: 600,
};
