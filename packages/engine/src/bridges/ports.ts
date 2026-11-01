import type { TxHash } from "@binference/chain";
import type { Id, Result } from "@binference/core";
import type {
  BridgeDraft,
  BridgeMove,
  BridgeMoveRefusal,
  BridgeQuery,
  BridgeRecord,
} from "./bridge-record.js";

/** What every store call takes: a call on an aborted signal rejects and changes nothing. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps each bridge's delivery (database spec, `bridges`, decision 0297): one row per bridge
 * intent, opened when its deposit is final and moved until a read settles it. Adapters: `bridges`
 * in engine.sqlite, and a fake.
 */
export interface BridgeStore {
  /**
   * Opens a bridge in `in_transit` at version 0 and answers it; a bridge of the intent already
   * held is answered as it is, and nothing changes, so a reconciliation run again opens it once. An
   * intent the store does not hold throws `store.constraint`.
   */
  open(draft: BridgeDraft, options: StoreCall): Promise<BridgeRecord>;
  /** The bridge of an intent, or `undefined` when it has none. */
  get(intentId: Id<"int">, options: StoreCall): Promise<BridgeRecord | undefined>;
  /**
   * The bridges in the query's states, the oldest deposit first, then by intent, from the first after
   * the query's `after` when it names one.
   */
  list(query: BridgeQuery, options: StoreCall): Promise<readonly BridgeRecord[]>;
  /**
   * The bridge a read settled with this transaction, as its fill or its refund, or `undefined`
   * when no bridge holds it.
   */
  settledBy(tx: TxHash, options: StoreCall): Promise<BridgeRecord | undefined>;
  /**
   * Moves a bridge when its stored version is `expectedVersion`, then raises the version by one:
   * `late` only from `in_transit`, `delivered` or `refunded` from `in_transit` or `late`. Another
   * version, a move its state does not take, or an intent with no bridge is `stale`; a fill another
   * bridge to the same chain holds, or a refund another bridge holds, is `taken`, so one
   * transaction settles one bridge at most. Either changes nothing.
   */
  move(move: BridgeMove, options: StoreCall): Promise<Result<BridgeRecord, BridgeMoveRefusal>>;
}
