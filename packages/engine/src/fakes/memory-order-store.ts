import { err, type Id, ok, type Result } from "@binference/core";
import type { StoredConfirmation } from "../intents/confirmation-record.js";
import type {
  OrderDraft,
  OrderMove,
  OrderMoveRefusal,
  OrderQuery,
  OrderRecord,
} from "../orders/order-record.js";
import { isOrderEnded } from "../orders/order-states.js";
import type { OrderStore } from "../orders/ports.js";
import type { MemoryAgentStore } from "./memory-agent-store.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";
import type { MemoryInstallStore } from "./memory-install-store.js";

/** An in-memory order store, whose moves another in-memory store's write can make. */
export interface MemoryOrderStore extends OrderStore {
  /**
   * Checks every move inside another in-memory store's write, such as a freeze, and answers the
   * orders after them without writing. An agent in `unfrozen`, which the same write unfreezes,
   * counts as not frozen. A broken rule throws.
   */
  checkNow(
    moves: readonly OrderMove[],
    unfrozen: ReadonlySet<Id<"agt">>,
  ): Result<readonly OrderRecord[], OrderMoveRefusal>;
  /** Writes orders `checkNow` answered, once the rest of the write has passed its checks. */
  saveNow(orders: readonly OrderRecord[]): void;
}

/** What the in-memory order store reads of the agents, wallets and confirmations beside it. */
export interface MemoryOrderStoreOptions {
  readonly agents: Pick<MemoryAgentStore, "agentNow">;
  readonly install: Pick<MemoryInstallStore, "walletNow">;
  /** The confirmation an intent holds, as the intent store beside it keeps it. */
  readonly confirmation: (intent: Id<"int">) => StoredConfirmation | undefined;
}

type Orders = Map<Id<"ord">, OrderRecord>;

function create(
  orders: Orders,
  options: MemoryOrderStoreOptions,
  draft: OrderDraft,
): Result<OrderRecord, "exists" | "frozen"> {
  const agent = options.agents.agentNow(draft.agentId);
  const wallet = options.install.walletNow(draft.walletId);
  if (agent === undefined || wallet?.agentId !== draft.agentId) {
    throw constraintFault(`order ${draft.id} names an unknown agent or another agent's wallet`);
  }
  if (orders.has(draft.id)) {
    return err("exists");
  }
  if (agent.frozenAtMs !== undefined) {
    return err("frozen");
  }
  const { atMs, ...fields } = draft;
  const record: OrderRecord = {
    ...fields,
    kind: draft.request.kind,
    state: "awaiting_confirmation",
    fills: 0,
    createdAtMs: atMs,
    changedAtMs: atMs,
    version: 0,
  };
  orders.set(record.id, structuredClone(record));
  return ok(record);
}

function checkRules(order: OrderRecord, move: OrderMove): void {
  if (isOrderEnded(order.state)) {
    throw constraintFault(`order ${order.id} has ended and never moves again`);
  }
  if (move.endReason !== undefined && move.state !== "ended") {
    throw constraintFault(`order ${order.id} takes an end reason only as it ends`);
  }
}

// A move into `active` needs the confirmation of the order's card and an agent that is not frozen.
function activeRefusal(
  options: MemoryOrderStoreOptions,
  order: OrderRecord,
  move: OrderMove & { readonly unfrozen: ReadonlySet<Id<"agt">> },
): OrderMoveRefusal | undefined {
  if (move.state !== "active") {
    return undefined;
  }
  const card = move.cardId ?? order.cardId;
  const confirmation = options.confirmation(order.intentId);
  if (card === undefined || confirmation?.cardId !== card) {
    return "not_confirmed";
  }
  const isFrozen =
    options.agents.agentNow(order.agentId)?.frozenAtMs !== undefined &&
    !move.unfrozen.has(order.agentId);
  return isFrozen ? "frozen" : undefined;
}

function movedOf(order: OrderRecord, move: OrderMove): OrderRecord {
  const { cardId, endReason, fills, triggerState, expiryNoticedAtMs } = move;
  return {
    ...order,
    state: move.state,
    ...(cardId === undefined ? {} : { cardId }),
    ...(endReason === undefined ? {} : { endReason }),
    ...(fills === undefined ? {} : { fills }),
    ...(triggerState === undefined ? {} : { triggerState }),
    ...(expiryNoticedAtMs === undefined ? {} : { expiryNoticedAtMs }),
    changedAtMs: move.atMs,
    version: order.version + 1,
  };
}

function checkOne(
  orders: Orders,
  options: MemoryOrderStoreOptions,
  move: OrderMove & { readonly unfrozen: ReadonlySet<Id<"agt">> },
): Result<OrderRecord, OrderMoveRefusal> {
  const order = orders.get(move.id);
  if (order === undefined) {
    return err("not_found");
  }
  if (order.version !== move.expectedVersion) {
    return err("stale");
  }
  checkRules(order, move);
  const refusal = activeRefusal(options, order, move);
  return refusal === undefined ? ok(movedOf(order, move)) : err(refusal);
}

function checkNow(
  orders: Orders,
  options: MemoryOrderStoreOptions,
  check: { readonly moves: readonly OrderMove[]; readonly unfrozen: ReadonlySet<Id<"agt">> },
): Result<readonly OrderRecord[], OrderMoveRefusal> {
  const { moves, unfrozen } = check;
  if (new Set(moves.map(({ id }) => id)).size !== moves.length) {
    throw constraintFault("one write moves an order twice");
  }
  const moved: OrderRecord[] = [];
  for (const move of moves) {
    const checked = checkOne(orders, options, { ...move, unfrozen });
    if (!checked.ok) {
      return checked;
    }
    moved.push(checked.value);
  }
  return ok(structuredClone(moved));
}

function saveNow(orders: Orders, moved: readonly OrderRecord[]): void {
  for (const order of moved) {
    orders.set(order.id, structuredClone(order));
  }
}

function moveAll(
  orders: Orders,
  options: MemoryOrderStoreOptions,
  moves: readonly OrderMove[],
): Result<readonly OrderRecord[], OrderMoveRefusal> {
  const checked = checkNow(orders, options, { moves, unfrozen: new Set() });
  if (checked.ok) {
    saveNow(orders, checked.value);
  }
  return checked;
}

function isAfter(order: OrderRecord, after: OrderQuery["after"]): boolean {
  return (
    after === undefined ||
    order.createdAtMs > after.createdAtMs ||
    (order.createdAtMs === after.createdAtMs && order.id > after.id)
  );
}

// Each filter of the query the order passes; an absent filter passes every order.
function matches(order: OrderRecord, query: OrderQuery): boolean {
  const { agentId, walletId, isPaper, expiresByMs } = query;
  return [
    query.states.includes(order.state),
    agentId === undefined || order.agentId === agentId,
    walletId === undefined || order.walletId === walletId,
    isPaper === undefined || order.isPaper === isPaper,
    expiresByMs === undefined || order.expiresAtMs <= expiresByMs,
    isAfter(order, query.after),
  ].every(Boolean);
}

/**
 * Creates an empty in-memory {@link MemoryOrderStore} for tests. Each write checks everything
 * first and changes nothing when a check fails, as the SQLite store's transaction does.
 */
export function createMemoryOrderStore(options: MemoryOrderStoreOptions): MemoryOrderStore {
  const orders: Orders = new Map();
  return {
    checkNow: (moves, unfrozen) =>
      checkNow(orders, options, { moves: structuredClone(moves), unfrozen }),
    saveNow: (moved) => {
      saveNow(orders, moved);
    },
    create: async (draft, call) =>
      memoryCall(call, () => create(orders, options, structuredClone(draft))),
    get: async (id, call) => memoryCall(call, () => structuredClone(orders.get(id))),
    byIntent: async (intent, call) =>
      memoryCall(call, () =>
        structuredClone([...orders.values()].find((order) => order.intentId === intent)),
      ),
    list: async (query, call) =>
      memoryCall(call, () =>
        structuredClone(
          [...orders.values()]
            .filter((order) => matches(order, query))
            .toSorted(byCreation)
            .slice(0, query.limit),
        ),
      ),
    move: async (moves, call) =>
      memoryCall(call, () => moveAll(orders, options, structuredClone(moves))),
  };
}
