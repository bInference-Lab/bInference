import type { Id, Result } from "@binference/core";
import type {
  FillAnnouncement,
  OrderFillQuery,
  OrderFillRecord,
  OrderFillWrite,
  UnannouncedFillQuery,
} from "./order-fill.js";
import type {
  OrderDraft,
  OrderMove,
  OrderMoveRefusal,
  OrderQuery,
  OrderRecord,
} from "./order-record.js";

/** What every store call takes: a call on an aborted signal rejects and changes nothing. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps auto orders (database spec, section 2.4; decision 0189). The order state machine decides
 * each move, and this store writes the moves all or nothing, each under the version its mover read.
 * Whatever the mover read, an order moves into `active` only while its `autoOrder` intent holds a
 * confirmation of the order's card and its agent is not frozen, both read in the same write.
 */
export interface OrderStore {
  /**
   * Stores a new order `awaiting_confirmation`, with no fill. An id in use is `exists` and a frozen
   * agent `frozen`; either stores nothing. An unknown agent, or a wallet that is not the agent's,
   * throws `store.constraint`.
   */
  create(draft: OrderDraft, options: StoreCall): Promise<Result<OrderRecord, "exists" | "frozen">>;
  /** One order, or `undefined` when the store has none with that id. */
  get(id: Id<"ord">, options: StoreCall): Promise<OrderRecord | undefined>;
  /** The order whose card the `autoOrder` intent carries, or `undefined`. */
  byIntent(intent: Id<"int">, options: StoreCall): Promise<OrderRecord | undefined>;
  /** Orders in the query's states, the oldest first, then by id. */
  list(query: OrderQuery, options: StoreCall): Promise<readonly OrderRecord[]>;
  /**
   * Writes every move all or nothing and answers the orders after them, in the moves' order. A
   * move out of `filled`, `cancelled`, `expired` or `ended`, an end reason on a move to another
   * state than `ended`, or two moves of one order throw `store.constraint`.
   */
  move(
    moves: readonly OrderMove[],
    options: StoreCall,
  ): Promise<Result<readonly OrderRecord[], OrderMoveRefusal>>;
  /**
   * Stores one fill row of an order (database spec, `order_fills`): a skip, with its reason and
   * the intent that ended, if one was stored. A fill that filled is stored with its intent's move
   * instead (`IntentStore.transition`). An id in use, an unknown order or intent, or a row whose
   * outcome and reason disagree throws `store.constraint`.
   */
  recordFill(fill: OrderFillRecord, options: StoreCall): Promise<OrderFillRecord>;
  /**
   * Counts a live fill that landed on its order apart from its intent's move (decision 0211): the
   * write's order moves and its `filled` row, which names the intent, all or nothing. An intent
   * that has a `filled` row already is `counted`, and an order at another version `stale`; either
   * writes nothing. A row that is no `filled` row naming its intent, or one without its order's
   * own move to one fill more, throws `store.constraint`.
   */
  recordLandedFill(
    write: OrderFillWrite,
    options: StoreCall,
  ): Promise<Result<readonly OrderRecord[], "counted" | "stale">>;
  /** The `filled` row that counts an intent's fill, or `undefined` while none does. */
  countedFill(intent: Id<"int">, options: StoreCall): Promise<OrderFillRecord | undefined>;
  /** One order's fill rows, the newest first, then by id from the last. */
  fills(query: OrderFillQuery, options: StoreCall): Promise<readonly OrderFillRecord[]>;
  /**
   * The fill rows of every order whose notices were never announced, the oldest first, then by
   * id (decision 0197).
   */
  unannounced(query: UnannouncedFillQuery, options: StoreCall): Promise<readonly OrderFillRecord[]>;
  /**
   * Marks the notices of fill rows announced at `atMs`. A row already announced keeps its time;
   * an unknown row, or one without notices, throws `store.constraint`.
   */
  markAnnounced(announcement: FillAnnouncement, options: StoreCall): Promise<void>;
}
