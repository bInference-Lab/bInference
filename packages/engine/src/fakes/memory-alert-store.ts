import type { AccountRef } from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import {
  type AlertFireDraft,
  alertFireKeepMs,
  alertFireOf,
  alertFireRowsPerAgent,
  type AlertFireWritten,
  type AlertWake,
  alertWakeWindowMs,
  type AlertWakeOutcome,
  canFire,
  maxAlertWakesPerHour,
  replacesWaitingWake,
  wakeAnswerOf,
} from "../alerts/alert-fire.js";
import {
  type AlertHeld,
  type AlertQuery,
  type AlertRecord,
  maxActiveAlerts,
  watchedAssetOf,
} from "../alerts/alert-record.js";
import type { AlertStore } from "../alerts/ports.js";
import { hasHeldToTell } from "../notices/notice-hour.js";
import type { AgentStore } from "../ports.js";
import type { MemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";
import { createMemoryTracking, type MemoryTracking } from "./memory-tracking.js";

interface StoreCall {
  readonly signal: AbortSignal;
}

/** The agents an in-memory alert store knows, and the inbox its fires store wake-ups in. */
export interface MemoryAlertStoreOptions {
  readonly agents: Pick<AgentStore, "get">;
  readonly agentInbox: Pick<MemoryAgentInboxStore, "wakeNow" | "replaceNow">;
  /** The tracked wallets it shares with the order fake; its own when absent. */
  readonly tracking?: MemoryTracking;
}

/** One fire as `alert_fires` keeps it. */
interface FireRow {
  readonly agentId: Id<"agt">;
  readonly atMs: number;
  readonly wake: AlertWakeOutcome;
}

interface Rows {
  readonly alerts: Map<Id<"alr">, AlertRecord>;
  /** Each fire by its alert and count, in the order they landed. */
  readonly fires: Map<string, FireRow>;
}

function isAfter(alert: AlertRecord, after: AlertQuery["after"]): boolean {
  return (
    after === undefined ||
    alert.createdAtMs > after.createdAtMs ||
    (alert.createdAtMs === after.createdAtMs && alert.id > after.id)
  );
}

function matches(alert: AlertRecord, query: AlertQuery): boolean {
  return (
    query.states.includes(alert.state) &&
    (query.agentId === undefined || alert.agentId === query.agentId) &&
    (query.kind === undefined || alert.condition.kind === query.kind) &&
    (query.asset === undefined || watchedAssetOf(alert.condition) === query.asset) &&
    isAfter(alert, query.after)
  );
}

function listed(rows: Rows, query: AlertQuery): readonly AlertRecord[] {
  return [...rows.alerts.values()]
    .filter((alert) => matches(alert, query))
    .toSorted(byCreation)
    .slice(0, query.limit);
}

function activeOf(rows: Rows): readonly AlertRecord[] {
  return [...rows.alerts.values()].filter((alert) => alert.state === "active");
}

// The accounts the install tracks for wallet alerts: those of the active wallet alerts of agents
// not archived.
function trackedAccounts(rows: Rows, archived: ReadonlySet<Id<"agt">>): ReadonlySet<AccountRef> {
  return new Set(
    activeOf(rows).flatMap(({ condition, agentId }) =>
      condition.kind === "wallet" && !archived.has(agentId) ? [condition.account] : [],
    ),
  );
}

// The agents of the active alerts that are gone or archived.
async function archivedAgents(
  rows: Rows,
  agents: MemoryAlertStoreOptions["agents"],
  call: { readonly signal: AbortSignal },
): Promise<ReadonlySet<Id<"agt">>> {
  const ids = [...new Set(activeOf(rows).map(({ agentId }) => agentId))];
  const read = await Promise.all(ids.map(async (id) => [id, await agents.get(id, call)] as const));
  return new Set(
    read.flatMap(([id, settings]) =>
      settings === undefined || settings.agent.archivedAtMs !== undefined ? [id] : [],
    ),
  );
}

function create(
  rows: Rows,
  alert: AlertRecord,
  tracking: MemoryTracking,
): Result<AlertRecord, "too_many" | "track_limit"> {
  if (rows.alerts.has(alert.id)) {
    throw constraintFault(`the alert id ${alert.id} is in use`);
  }
  const held = activeOf(rows).filter(({ agentId }) => agentId === alert.agentId);
  if (held.length >= maxActiveAlerts) {
    return err("too_many");
  }
  const { condition } = alert;
  if (condition.kind === "wallet" && !tracking.hasRoom(condition.account)) {
    return err("track_limit");
  }
  rows.alerts.set(alert.id, structuredClone(alert));
  return ok(structuredClone(alert));
}

function put(rows: Rows, alert: AlertRecord): AlertRecord {
  rows.alerts.set(alert.id, structuredClone(alert));
  return structuredClone(alert);
}

function firesOf(rows: Rows, agentId: Id<"agt">): readonly FireRow[] {
  return [...rows.fires.values()].filter((row) => row.agentId === agentId);
}

// The wake-ups the hourly limit held back since the agent's last one.
function heldBack(rows: Rows, agentId: Id<"agt">): number {
  const own = firesOf(rows, agentId);
  const lastWoke = own.findLastIndex((row) => row.wake.outcome === "woke");
  const after = own.slice(lastWoke + 1);
  return after.filter((row) => row.wake.outcome === "skipped" && row.wake.reason === "hourly")
    .length;
}

// A new wake-up, unless the agent's alerts woke it 10 times in the last hour or its inbox is full.
function newWake(
  rows: Rows,
  inbox: MemoryAlertStoreOptions["agentInbox"],
  call: { readonly alert: AlertRecord; readonly wake: AlertWake; readonly atMs: number },
): AlertWakeOutcome {
  const { alert, wake, atMs } = call;
  const recent = firesOf(rows, alert.agentId).filter(
    (row) => row.wake.outcome === "woke" && row.atMs > atMs - alertWakeWindowMs,
  );
  if (recent.length >= maxAlertWakesPerHour) {
    return { outcome: "skipped", reason: "hourly" };
  }
  const stored = inbox.wakeNow({ agentId: alert.agentId, kind: "inbox/alertFired", wake, atMs });
  return stored.ok
    ? { outcome: "woke", message: stored.value }
    : { outcome: "skipped", reason: "busy" };
}

function wakeOf(
  rows: Rows,
  inbox: MemoryAlertStoreOptions["agentInbox"],
  call: { readonly alert: AlertRecord; readonly draft: AlertFireDraft },
): AlertWakeOutcome {
  const { alert, draft } = call;
  const { wake, skip, atMs } = draft;
  if (skip !== undefined) {
    return { outcome: "skipped", reason: skip };
  }
  if (wake === undefined) {
    return { outcome: "quiet" };
  }
  const waiting =
    alert.lastMessageId === undefined || !replacesWaitingWake(alert)
      ? undefined
      : inbox.replaceNow(alert.lastMessageId, wake.payload);
  return waiting === undefined
    ? newWake(rows, inbox, { alert, wake, atMs })
    : { outcome: "replaced", message: waiting };
}

// Keeps the fire's row, and forgets the agent's rows older than a week or past its newest 1,000.
function keep(rows: Rows, draft: AlertFireDraft, row: FireRow): void {
  rows.fires.set(`${draft.id}:${String(draft.expectedFires)}`, row);
  const own = [...rows.fires.keys()].filter((key) => rows.fires.get(key)?.agentId === row.agentId);
  const tooMany = own.length - alertFireRowsPerAgent;
  own.forEach((key, index) => {
    const kept = rows.fires.get(key);
    if (index < tooMany || (kept !== undefined && kept.atMs < draft.atMs - alertFireKeepMs)) {
      rows.fires.delete(key);
    }
  });
}

function fire(
  rows: Rows,
  inbox: MemoryAlertStoreOptions["agentInbox"],
  draft: AlertFireDraft,
): Result<AlertFireWritten, "stale"> {
  const alert = rows.alerts.get(draft.id);
  if (alert === undefined || !canFire(alert, draft)) {
    return err("stale");
  }
  const wake = wakeOf(rows, inbox, { alert, draft });
  const wakeSkipped = wake.outcome === "woke" ? heldBack(rows, alert.agentId) : 0;
  keep(rows, draft, { agentId: alert.agentId, atMs: draft.atMs, wake });
  const fired = alertFireOf(alert, draft.atMs);
  const lastMessage = "message" in wake ? { lastMessageId: wake.message.id } : {};
  const written = put(rows, { ...fired.alert, ...lastMessage });
  return ok({ ...fired, alert: written, ...wakeAnswerOf(wake, wakeSkipped) });
}

function end(rows: Rows, atMs: number, limit: number): readonly AlertRecord[] {
  const due = activeOf(rows)
    .filter(({ expiresAtMs }) => expiresAtMs !== undefined && expiresAtMs <= atMs)
    .toSorted((left, right) => (left.expiresAtMs ?? 0) - (right.expiresAtMs ?? 0))
    .slice(0, limit);
  return due.map((alert) => put(rows, { ...alert, state: "ended", changedAtMs: atMs }));
}

// The alerts whose notice hour ended with matches held back, their counts cleared.
function heldNotices(rows: Rows, atMs: number, limit: number): readonly AlertHeld[] {
  const due = [...rows.alerts.values()]
    .filter(({ noticeWindow }) => hasHeldToTell(noticeWindow, atMs))
    .toSorted(byCreation)
    .slice(0, limit);
  return due.flatMap(({ noticeWindow, ...alert }) =>
    noticeWindow === undefined
      ? []
      : [
          {
            alert: put(rows, { ...alert, noticeWindow: { ...noticeWindow, held: 0 } }),
            held: noticeWindow.held,
          },
        ],
  );
}

// Moves an active alert to `state`, at `atMs`.
function closeOne(
  rows: Rows,
  change: { readonly id: Id<"alr">; readonly atMs: number },
  state: "deleted" | "ended",
): AlertRecord | undefined {
  const stored = rows.alerts.get(change.id);
  return stored?.state === "active"
    ? put(rows, { ...stored, state, changedAtMs: change.atMs })
    : undefined;
}

/** Creates an empty in-memory {@link AlertStore} for tests. */
export function createMemoryAlertStore(options: MemoryAlertStoreOptions): AlertStore {
  const rows: Rows = { alerts: new Map(), fires: new Map() };
  const tracking = options.tracking ?? createMemoryTracking();
  tracking.addSource(async (call) =>
    trackedAccounts(rows, await archivedAgents(rows, options.agents, call)),
  );
  // Each write that can end a wallet alert moves the tracked wallets in the same call.
  const reconciled = async <T>(atMs: number, call: StoreCall, written: T): Promise<T> => {
    await tracking.reconcile(atMs, call);
    return written;
  };
  return {
    async create(alert, call) {
      call.signal.throwIfAborted();
      const agent = await options.agents.get(alert.agentId, call);
      if (agent === undefined) {
        return err("not_found");
      }
      await tracking.reconcile(alert.createdAtMs, call);
      return reconciled(alert.createdAtMs, call, create(rows, alert, tracking));
    },
    get: async (id, call) => memoryCall(call, () => structuredClone(rows.alerts.get(id))),
    list: async (query, call) => memoryCall(call, () => structuredClone(listed(rows, query))),
    delete: async (change, call) =>
      reconciled(
        change.atMs,
        call,
        await memoryCall(call, () => closeOne(rows, change, "deleted")),
      ),
    end: async (change, call) =>
      reconciled(change.atMs, call, await memoryCall(call, () => closeOne(rows, change, "ended"))),
    heldNotices: async ({ atMs, limit }, call) =>
      memoryCall(call, () => heldNotices(rows, atMs, limit)),
    expire: async ({ atMs, limit }, call) =>
      reconciled(atMs, call, await memoryCall(call, () => end(rows, atMs, limit))),
    fire: async (draft, call) =>
      reconciled(
        draft.atMs,
        call,
        await memoryCall(call, () => fire(rows, options.agentInbox, draft)),
      ),
  };
}
