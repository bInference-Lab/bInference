import type { AccountRef } from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import { type LiftedHolds, noLift, staysHeld } from "../agents/breaker-hold.js";
import type { StoredConfirmation } from "../intents/confirmation-record.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { copyLeaderOf, trackingOrderStates } from "../orders/copy-leader.js";
import { type OrderFillRecord, type OrderFillWrite, recordsOwnFill } from "../orders/order-fill.js";
import { countsLandedFill } from "../orders/order-machine.js";
import type {
  OrderDraft,
  OrderMove,
  OrderMoveRefusal,
  OrderRecord,
} from "../orders/order-record.js";
import { isOrderEnded } from "../orders/order-states.js";
import type { OrderStore } from "../orders/ports.js";
import type { MemoryAgentStore } from "./memory-agent-store.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";
import type { MemoryInstallStore } from "./memory-install-store.js";
import { isOverOpenOrders } from "./memory-open-orders.js";
import { createMemoryOrderFills, type MemoryOrderFills } from "./memory-order-fills.js";
import { matchesOrderQuery } from "./memory-order-query.js";
import { rowReadsOf } from "./memory-order-row-reads.js";
import { createMemoryTracking, type MemoryTracking } from "./memory-tracking.js";

/** An in-memory order store, whose moves another in-memory store's write can make. */
export interface MemoryOrderStore extends OrderStore, MemoryOrderFills {
  /**
   * Checks every move inside another in-memory store's write, such as a freeze, and answers the
   * orders after them without writing. What the same write lifts, an owner's freeze or the
   * breaker's hold, counts as lifted. A broken rule throws.
   */
  checkNow(
    moves: readonly OrderMove[],
    lifted: LiftedHolds,
  ): Result<readonly OrderRecord[], OrderMoveRefusal>;
  /** Writes orders `checkNow` answered, once the rest of the write has passed its checks. */
  saveNow(orders: readonly OrderRecord[]): void;
  /**
   * Checks a fill's write on its order inside an intent's move or a late landing, as a landed fill
   * is checked: its row, then its moves as `checkNow` does, answering a refusal as `stale`, then
   * its order's own move to one fill more. A broken rule throws.
   */
  checkWriteNow(write: OrderFillWrite): Result<readonly OrderRecord[], "stale">;
}

/** What the in-memory order store reads of the agents, wallets and confirmations beside it. */
export interface MemoryOrderStoreOptions {
  readonly agents: Pick<MemoryAgentStore, "agentNow">;
  readonly install: Pick<MemoryInstallStore, "walletNow">;
  /** The confirmation an intent holds, as the intent store beside it keeps it. */
  readonly confirmation: (intent: Id<"int">) => StoredConfirmation | undefined;
  /** Whether the intent store beside it holds the intent. */
  readonly hasIntent: (intent: Id<"int">) => boolean;
  /** An intent's kind and judged value, as the intent store beside it keeps them. */
  readonly intentNow?: (intent: Id<"int">) => IntentRecord | undefined;
  /** The tracked wallets it shares with the alert fake; its own when absent. */
  readonly tracking?: MemoryTracking;
}

type Orders = Map<Id<"ord">, OrderRecord>;

function create(
  orders: Orders,
  options: MemoryOrderStoreOptions,
  { draft, quota }: { readonly draft: OrderDraft; readonly quota: number | undefined },
): Result<OrderRecord, "exists" | "frozen" | "quota"> {
  const agent = options.agents.agentNow(draft.agentId);
  const wallet = options.install.walletNow(draft.walletId);
  if (agent === undefined || wallet?.agentId !== draft.agentId) {
    throw constraintFault(`order ${draft.id} names an unknown agent or another agent's wallet`);
  }
  if (orders.has(draft.id)) {
    return err("exists");
  }
  if ([...orders.values()].some((order) => order.intentId === draft.intentId)) {
    throw constraintFault(`order ${draft.id} names a card intent another order holds`);
  }
  if (agent.frozenAtMs !== undefined) {
    return err("frozen");
  }
  if (isOverOpenOrders(orders.values(), draft.agentId, quota)) {
    return err("quota");
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
  if (isOrderEnded(order.state) && !countsLandedFill(order, move)) {
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
  move: OrderMove & { readonly lifted: LiftedHolds },
): OrderMoveRefusal | undefined {
  if (move.state !== "active") {
    return undefined;
  }
  const card = move.cardId ?? order.cardId;
  const confirmation = options.confirmation(order.intentId);
  if (card === undefined || confirmation?.cardId !== card) {
    return "not_confirmed";
  }
  const agent = options.agents.agentNow(order.agentId);
  return agent !== undefined && staysHeld(agent, move.lifted) ? "frozen" : undefined;
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
  move: OrderMove & { readonly lifted: LiftedHolds },
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
  check: { readonly moves: readonly OrderMove[]; readonly lifted: LiftedHolds },
): Result<readonly OrderRecord[], OrderMoveRefusal> {
  const { moves, lifted } = check;
  if (new Set(moves.map(({ id }) => id)).size !== moves.length) {
    throw constraintFault("one write moves an order twice");
  }
  const moved: OrderRecord[] = [];
  for (const move of moves) {
    const checked = checkOne(orders, options, { ...move, lifted });
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
  const checked = checkNow(orders, options, { moves, lifted: noLift });
  if (checked.ok) {
    saveNow(orders, checked.value);
  }
  return checked;
}

interface FillParts {
  readonly orders: Orders;
  readonly options: MemoryOrderStoreOptions;
  readonly fills: MemoryOrderFills;
}

// A fill's write on its order, as each write that counts one checks it: its row, its moves under
// their versions, `stale` when one moved on, then its order's own move to one fill more.
function checkFillWrite(
  store: FillParts,
  write: OrderFillWrite,
): Result<readonly OrderRecord[], "stale"> {
  const { orders, options, fills } = store;
  fills.checkFillNow(write.fill);
  const checked = checkNow(orders, options, {
    moves: structuredClone(write.moves),
    lifted: noLift,
  });
  if (!checked.ok) {
    return err("stale");
  }
  if (!recordsOwnFill(write, orders.get(write.fill.orderId)?.fills ?? 0)) {
    throw constraintFault(`fill ${write.fill.id} lands without its order's own move`);
  }
  return checked;
}

// Whether the row under `fill`'s id holds exactly `fill`, however its notices were told since: the
// same write that counted it run again (decision 0413).
function holdsFill(fills: MemoryOrderFills, fill: OrderFillRecord): boolean {
  const row = fills.rowsNow().find(({ id }) => id === fill.id);
  if (row === undefined) {
    return false;
  }
  const { announcedAtMs: _told, ...stored } = row;
  const { announcedAtMs: _given, ...given } = fill;
  return JSON.stringify(stored) === JSON.stringify(given);
}

// The orders a fill's moves name, as they stand.
function ordersMoved(orders: Orders, write: OrderFillWrite): readonly OrderRecord[] {
  return structuredClone(write.moves.flatMap(({ id }) => orders.get(id) ?? []));
}

// A landed live fill counted apart from its intent's move: once per intent, all or nothing; the
// same write run again answers the orders its moves name, as they stand.
function landFill(
  store: FillParts,
  write: OrderFillWrite,
): Result<readonly OrderRecord[], "counted" | "stale"> {
  const { orders, fills } = store;
  const { fill } = write;
  if (fill.outcome !== "filled" || fill.intentId === undefined) {
    throw constraintFault(`fill ${fill.id} is no filled row naming its intent`);
  }
  if (fills.isCountedNow(fill.intentId)) {
    return holdsFill(fills, fill) ? ok(ordersMoved(orders, write)) : err("counted");
  }
  const checked = checkFillWrite(store, write);
  if (!checked.ok) {
    return checked;
  }
  saveNow(orders, checked.value);
  fills.saveFillNow(fill);
  return ok(structuredClone(checked.value));
}

// The leaders of the live copy orders of agents not archived.
function leadersOf(orders: Orders, options: MemoryOrderStoreOptions): ReadonlySet<AccountRef> {
  return new Set(
    [...orders.values()].flatMap((order) => {
      const leader = copyLeaderOf(order.request);
      const agent = options.agents.agentNow(order.agentId);
      const isLive = trackingOrderStates.includes(order.state);
      return leader !== undefined && isLive && agent?.archivedAtMs === undefined ? [leader] : [];
    }),
  );
}

// The creates and moves, which move the tracked wallets of copy orders in the same call.
function trackedCalls(
  orders: Orders,
  options: MemoryOrderStoreOptions,
): Pick<OrderStore, "create" | "move"> {
  const tracking = options.tracking ?? createMemoryTracking();
  tracking.addSource(async () => Promise.resolve(leadersOf(orders, options)));
  return {
    async create(draft, call) {
      const leader = copyLeaderOf(draft.request);
      const write = { draft: structuredClone(draft), quota: call.quota };
      if (leader === undefined) {
        return memoryCall(call, () => create(orders, options, write));
      }
      await tracking.reconcile(draft.atMs, call);
      const made = await memoryCall(call, () =>
        tracking.hasRoom(leader) ? create(orders, options, write) : err("track_limit" as const),
      );
      await tracking.reconcile(draft.atMs, call);
      return made;
    },
    async move(moves, call) {
      const moved = await memoryCall(call, () => moveAll(orders, options, structuredClone(moves)));
      const [first] = moves;
      if (moved.ok && first !== undefined && moved.value.some(({ kind }) => kind === "copy")) {
        await tracking.reconcile(first.atMs, call);
      }
      return moved;
    },
  };
}

/**
 * Creates an empty in-memory {@link MemoryOrderStore} for tests. Each write checks everything
 * first and changes nothing when a check fails, as the SQLite store's transaction does.
 */
export function createMemoryOrderStore(options: MemoryOrderStoreOptions): MemoryOrderStore {
  const orders: Orders = new Map();
  const tracked = trackedCalls(orders, options);
  const fills = createMemoryOrderFills({
    hasOrder: (id) => orders.has(id),
    hasIntent: options.hasIntent,
  });
  return {
    ...fills,
    ...rowReadsOf({ orders, rowsNow: () => fills.rowsNow(), intentNow: options.intentNow }),
    checkWriteNow: (write) => checkFillWrite({ orders, options, fills }, write),
    checkNow: (moves, lifted) =>
      checkNow(orders, options, { moves: structuredClone(moves), lifted }),
    saveNow: (moved) => {
      saveNow(orders, moved);
    },
    create: tracked.create,
    get: async (id, call) => memoryCall(call, () => structuredClone(orders.get(id))),
    byIntent: async (intent, call) =>
      memoryCall(call, () =>
        structuredClone([...orders.values()].find((order) => order.intentId === intent)),
      ),
    list: async (query, call) =>
      memoryCall(call, () =>
        structuredClone(
          [...orders.values()]
            .filter((order) => matchesOrderQuery(order, query))
            .toSorted(byCreation)
            .slice(0, query.limit),
        ),
      ),
    move: tracked.move,
    recordLandedFill: async (write, call) =>
      memoryCall(call, () => landFill({ orders, options, fills }, structuredClone(write))),
  };
}
