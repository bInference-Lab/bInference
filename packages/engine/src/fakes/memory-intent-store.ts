import { err, type Id, ok, type Result } from "@binference/core";
import type { StoredConfirmation } from "../intents/confirmation-record.js";
import type { ConfirmedIntent, ConfirmedQuery } from "../intents/confirmed-intent.js";
import type { FreezeCommit, FreezeWrite } from "../intents/freeze-write.js";
import type {
  IntentChange,
  IntentCommit,
  IntentEventRecord,
  IntentQuery,
} from "../intents/intent-change.js";
import type { IntentDraft, IntentRecord } from "../intents/intent-record.js";
import type { LateLanding } from "../intents/late-landing.js";
import type { LedgerDraft, LedgerEntry } from "../ledger/ledger-entry.js";
import { newestStoredAssets } from "../money-path/asset-infos.js";
import type { OrderRecord } from "../orders/order-record.js";
import type { IntentStore } from "../ports.js";
import type { MemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import type { MemoryAgentStore } from "./memory-agent-store.js";
import { constraintFault, memoryCall } from "./memory-call.js";
import { fillsInFlightOf, recordLandedLate } from "./memory-fill-landings.js";
import type { MemoryInstallStore } from "./memory-install-store.js";
import { createMemoryIntentTables, type MemoryIntentTables } from "./memory-intent-tables.js";
import type { MemoryLedgerStore } from "./memory-ledger-store.js";
import type { MemoryOrderStore } from "./memory-order-store.js";

/**
 * What an in-memory intent store writes its ledger entries to, the agents and the install a
 * freeze marks, the orders a freeze moves, and the agent inbox it writes settle messages to, when
 * there is one.
 */
export interface MemoryIntentStoreOptions {
  readonly ledger: MemoryLedgerStore;
  readonly agents: MemoryAgentStore;
  readonly install: MemoryInstallStore;
  /** The orders of the same database; a freeze that moves an order needs them. */
  readonly orders?: MemoryOrderStore;
  readonly agentInbox?: MemoryAgentInboxStore;
}

/** An in-memory intent store whose confirmations another in-memory store's write can read. */
export interface MemoryIntentStore extends IntentStore {
  /** The confirmation the intent holds now, or `undefined`. */
  confirmationNow(id: Id<"int">): StoredConfirmation | undefined;
  /** The intent as it stands now, or `undefined`. */
  intentNow(id: Id<"int">): IntentRecord | undefined;
}

function appendTo(
  ledger: MemoryLedgerStore,
  draft: LedgerDraft | undefined,
): LedgerEntry | undefined {
  return draft === undefined ? undefined : ledger.appendNow(draft);
}

/**
 * What one write of an intent stored: the intent after it, its event and its ledger entry, and
 * the orders a fill's write moved.
 */
interface Written {
  readonly intent: IntentRecord;
  readonly event: IntentEventRecord;
  readonly ledgerEntry: LedgerEntry | undefined;
  readonly orders?: readonly OrderRecord[];
}

// The commit of a write, with the settle message the write left in the agent inbox, if any.
function commitOf(
  tables: MemoryIntentTables,
  options: Pick<MemoryIntentStoreOptions, "agentInbox">,
  written: Written,
): IntentCommit {
  const { intent, event, ledgerEntry, orders } = written;
  const settled = options.agentInbox?.settleNow(intent, tables.events(intent.id)[0]);
  return structuredClone({
    intent,
    event,
    ...(ledgerEntry === undefined ? {} : { ledgerEntry }),
    ...(settled === undefined ? {} : { settled }),
    ...(orders === undefined ? {} : { orders }),
  });
}

function create(
  tables: MemoryIntentTables,
  options: MemoryIntentStoreOptions,
  draft: IntentDraft,
): Result<IntentCommit, "exists"> {
  const { ledger } = options;
  if (tables.intent(draft.id) !== undefined) {
    return err("exists");
  }
  const { atMs, cause, ledger: ledgerDraft, ...fields } = draft;
  const ledgerEntry = appendTo(ledger, ledgerDraft);
  const intent: IntentRecord = { ...fields, createdAtMs: atMs, changedAtMs: atMs, version: 0 };
  tables.saveIntent(intent);
  const event = tables.addEvent({ intentId: intent.id, toState: intent.state, cause, atMs });
  return ok(commitOf(tables, options, { intent, event, ledgerEntry }));
}

// A move whose intent is unknown or at another version; its card writes throw when they would fail.
function checkMove(
  tables: MemoryIntentTables,
  change: IntentChange,
): Result<IntentRecord, "not_found" | "stale"> {
  const current = tables.intent(change.id);
  if (current === undefined) {
    return err("not_found");
  }
  if (current.version !== change.expectedVersion) {
    return err("stale");
  }
  tables.checkCardWrites(change);
  return ok(current);
}

/** A move checked against the intent as it stands, with the orders a fill's write moves. */
interface CheckedMove {
  readonly change: IntentChange;
  readonly current: IntentRecord;
  readonly orders?: readonly OrderRecord[];
}

function writeMove(
  tables: MemoryIntentTables,
  options: MemoryIntentStoreOptions,
  { change, current, orders }: CheckedMove,
): IntentCommit {
  const ledgerEntry = appendTo(options.ledger, change.ledger);
  const intent: IntentRecord = {
    ...current,
    ...change.fields,
    state: change.state,
    changedAtMs: change.atMs,
    version: current.version + 1,
  };
  tables.saveIntent(intent);
  tables.saveCardWrites(change);
  const event = tables.addEvent({
    intentId: intent.id,
    fromState: current.state,
    toState: intent.state,
    cause: change.cause,
    atMs: change.atMs,
  });
  if (change.order !== undefined && orders !== undefined) {
    options.orders?.saveNow(orders);
    options.orders?.saveFillNow(change.order.fill);
  }
  return commitOf(tables, options, {
    intent,
    event,
    ledgerEntry,
    ...(orders === undefined ? {} : { orders }),
  });
}

function transition(
  tables: MemoryIntentTables,
  options: MemoryIntentStoreOptions,
  change: IntentChange,
): Result<IntentCommit, "not_found" | "stale"> {
  const checked = checkedMove(tables, options, change);
  return checked.ok ? ok(writeMove(tables, options, checked.value)) : checked;
}

// The order store beside this one, which a write that moves orders needs.
function ordersOf(options: MemoryIntentStoreOptions): MemoryOrderStore {
  if (options.orders === undefined) {
    throw constraintFault("a write moves orders this store holds none of");
  }
  return options.orders;
}

// A move checked as it stands, with a fill's skip row, which lands with the freeze's cancel of its
// intent (decision 0197).
function checkedMove(
  tables: MemoryIntentTables,
  options: MemoryIntentStoreOptions,
  change: IntentChange,
): Result<CheckedMove, "not_found" | "stale"> {
  const current = checkMove(tables, change);
  if (!current.ok || change.order === undefined) {
    return current.ok ? ok({ change, current: current.value }) : current;
  }
  const fill = ordersOf(options).checkWriteNow(change.order);
  return fill.ok ? ok({ change, current: current.value, orders: fill.value }) : fill;
}

// Every move is checked before the agents are marked, and nothing is written before both pass.
// The freeze's order moves, checked as they would land after its agents are marked: an agent an
// unfreeze lifts counts as not frozen. A refusal is the freeze's `stale`, as the SQLite store's.
function checkOrders(
  options: MemoryIntentStoreOptions,
  write: FreezeWrite,
): Result<readonly OrderRecord[], "stale"> {
  if (write.orders.length === 0) {
    return ok([]);
  }
  const store = ordersOf(options);
  const unfrozen = new Set(write.isFrozen ? [] : write.agents.map(({ agentId }) => agentId));
  const checked = store.checkNow(write.orders, unfrozen);
  return checked.ok ? checked : err("stale");
}

function freeze(
  tables: MemoryIntentTables,
  options: MemoryIntentStoreOptions,
  write: FreezeWrite,
): Result<FreezeCommit, "not_found" | "stale"> {
  const checked: CheckedMove[] = [];
  for (const change of write.moves) {
    const move = checkedMove(tables, options, change);
    if (!move.ok) {
      return move;
    }
    checked.push(move.value);
  }
  const orders = checkOrders(options, write);
  if (!orders.ok) {
    return orders;
  }
  const change = { atMs: write.atMs, isFrozen: write.isFrozen };
  const agents = options.agents.freezeNow(write.agents, change);
  if (!agents.ok) {
    return agents;
  }
  options.orders?.saveNow(orders.value);
  if (write.isWholeInstall) {
    options.install.freezeNow(change);
  }
  const moves = checked.map((move) => writeMove(tables, options, move));
  const ledgerEntries = write.ledger.map((draft) => options.ledger.appendNow(draft));
  return ok(structuredClone({ agents: agents.value, moves, orders: orders.value, ledgerEntries }));
}

// Orders as the SQLite store does: by change time, then by id in code-unit order, never by locale.
function byChange(left: IntentRecord, right: IntentRecord): number {
  if (left.changedAtMs !== right.changedAtMs) {
    return left.changedAtMs - right.changedAtMs;
  }
  return left.id < right.id ? -1 : 1;
}

function matches(intent: IntentRecord, query: IntentQuery): boolean {
  const { after, agentId, isPaper } = query;
  const isAfter =
    after === undefined ||
    intent.changedAtMs > after.changedAtMs ||
    (intent.changedAtMs === after.changedAtMs && intent.id > after.id);
  return (
    query.states.includes(intent.state) &&
    (agentId === undefined || intent.agentId === agentId) &&
    (isPaper === undefined || intent.isPaper === isPaper) &&
    isAfter
  );
}

// Each intent of the agent in the mode with a move to `confirmed` at or after the query's time.
function confirmedSince(
  tables: MemoryIntentTables,
  landings: ReadonlyMap<Id<"int">, LateLanding>,
  query: ConfirmedQuery,
): readonly ConfirmedIntent[] {
  return tables
    .intents()
    .filter((intent) => intent.agentId === query.agentId && intent.isPaper === query.isPaper)
    .flatMap((intent): readonly ConfirmedIntent[] => {
      const moved = tables
        .events(intent.id)
        .find((event) => event.toState === "confirmed" && event.atMs >= query.fromMs);
      const landed = landings.get(intent.id);
      return moved === undefined
        ? []
        : [
            {
              intentId: intent.id,
              state: intent.state,
              confirmedAtMs: moved.atMs,
              ...(intent.valueUsdMicros === undefined
                ? {}
                : { valueUsdMicros: intent.valueUsdMicros }),
              ...(landed === undefined ? {} : { landedLateAtMs: landed.atMs }),
            },
          ];
    })
    .toSorted(
      (left, right) =>
        left.confirmedAtMs - right.confirmedAtMs || (left.intentId < right.intentId ? -1 : 1),
    );
}

/**
 * Creates an empty in-memory {@link IntentStore} for tests. Each write checks everything first and
 * changes nothing when a check fails, as the SQLite store's transaction does.
 */
export function createMemoryIntentStore(options: MemoryIntentStoreOptions): MemoryIntentStore {
  const tables = createMemoryIntentTables();
  const landings = new Map<Id<"int">, LateLanding>();
  return {
    confirmationNow: (id) => tables.confirmation(id),
    intentNow: (id) => tables.intent(id),
    create: async (draft, call) => memoryCall(call, () => create(tables, options, draft)),
    get: async (id, call) => memoryCall(call, () => tables.intent(id)),
    transition: async (change, call) => memoryCall(call, () => transition(tables, options, change)),
    freeze: async (write, call) => memoryCall(call, () => freeze(tables, options, write)),
    list: async (query, call) =>
      memoryCall(call, () =>
        tables
          .intents()
          .filter((intent) => matches(intent, query))
          .toSorted(byChange)
          .slice(0, query.limit),
      ),
    fillsInFlight: async (query, call) =>
      memoryCall(call, () =>
        fillsInFlightOf({ tables, landings, orders: options.orders }, query).toSorted(byChange),
      ),
    storedAssets: async (assets, call) =>
      memoryCall(call, () => newestStoredAssets(tables.intents(), assets)),
    confirmedSince: async (query, call) =>
      memoryCall(call, () => confirmedSince(tables, landings, query)),
    recordLandedLate: async (landing, call) =>
      memoryCall(call, () =>
        recordLandedLate({ tables, landings, orders: options.orders }, structuredClone(landing)),
      ),
    events: async (id, call) => memoryCall(call, () => tables.events(id)),
    cards: async (id, call) =>
      memoryCall(call, () =>
        tables.cards(id).toSorted((left, right) => left.version - right.version),
      ),
    confirmation: async (id, call) => memoryCall(call, () => tables.confirmation(id)),
    cardByRef: async (callbackRef, call) => memoryCall(call, () => tables.cardByRef(callbackRef)),
  };
}
