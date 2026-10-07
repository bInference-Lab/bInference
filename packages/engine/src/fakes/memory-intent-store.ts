import { err, ok, type Result } from "@binference/core";
import type {
  IntentChange,
  IntentCommit,
  IntentEventRecord,
  IntentQuery,
} from "../intents/intent-change.js";
import type { IntentDraft, IntentRecord } from "../intents/intent-record.js";
import type { LedgerDraft, LedgerEntry } from "../ledger/ledger-entry.js";
import type { IntentStore } from "../ports.js";
import { memoryCall } from "./memory-call.js";
import { createMemoryIntentTables, type MemoryIntentTables } from "./memory-intent-tables.js";
import type { MemoryLedgerStore } from "./memory-ledger-store.js";

/** What an in-memory intent store writes its ledger entries to. */
export interface MemoryIntentStoreOptions {
  readonly ledger: MemoryLedgerStore;
}

function appendTo(
  ledger: MemoryLedgerStore,
  draft: LedgerDraft | undefined,
): LedgerEntry | undefined {
  return draft === undefined ? undefined : ledger.appendNow(draft);
}

function commitOf(
  intent: IntentRecord,
  event: IntentEventRecord,
  ledgerEntry: LedgerEntry | undefined,
): IntentCommit {
  return structuredClone({ intent, event, ...(ledgerEntry === undefined ? {} : { ledgerEntry }) });
}

function create(
  tables: MemoryIntentTables,
  ledger: MemoryLedgerStore,
  draft: IntentDraft,
): Result<IntentCommit, "exists"> {
  if (tables.intent(draft.id) !== undefined) {
    return err("exists");
  }
  const { atMs, cause, ledger: ledgerDraft, ...fields } = draft;
  const ledgerEntry = appendTo(ledger, ledgerDraft);
  const intent: IntentRecord = { ...fields, createdAtMs: atMs, changedAtMs: atMs, version: 0 };
  tables.saveIntent(intent);
  const event = tables.addEvent({ intentId: intent.id, toState: intent.state, cause, atMs });
  return ok(commitOf(intent, event, ledgerEntry));
}

function transition(
  tables: MemoryIntentTables,
  ledger: MemoryLedgerStore,
  change: IntentChange,
): Result<IntentCommit, "not_found" | "stale"> {
  const current = tables.intent(change.id);
  if (current === undefined) {
    return err("not_found");
  }
  if (current.version !== change.expectedVersion) {
    return err("stale");
  }
  tables.checkCardWrites(change);
  const ledgerEntry = appendTo(ledger, change.ledger);
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
  return ok(commitOf(intent, event, ledgerEntry));
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

/**
 * Creates an empty in-memory {@link IntentStore} for tests. Each write checks everything first and
 * changes nothing when a check fails, as the SQLite store's transaction does.
 */
export function createMemoryIntentStore(options: MemoryIntentStoreOptions): IntentStore {
  const tables = createMemoryIntentTables();
  return {
    create: async (draft, call) => memoryCall(call, () => create(tables, options.ledger, draft)),
    get: async (id, call) => memoryCall(call, () => tables.intent(id)),
    transition: async (change, call) =>
      memoryCall(call, () => transition(tables, options.ledger, change)),
    list: async (query, call) =>
      memoryCall(call, () =>
        tables
          .intents()
          .filter((intent) => matches(intent, query))
          .toSorted(byChange)
          .slice(0, query.limit),
      ),
    events: async (id, call) => memoryCall(call, () => tables.events(id)),
    cards: async (id, call) =>
      memoryCall(call, () =>
        tables.cards(id).toSorted((left, right) => left.version - right.version),
      ),
    confirmation: async (id, call) => memoryCall(call, () => tables.confirmation(id)),
  };
}
