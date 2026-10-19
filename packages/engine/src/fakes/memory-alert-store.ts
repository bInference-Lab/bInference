import { err, type Id, ok, type Result } from "@binference/core";
import {
  type AlertFireDraft,
  alertAfterFire,
  alertFireKeepMs,
  type AlertFireWritten,
  type AlertWake,
  alertWakeWindowMs,
  type AlertWakeOutcome,
  canFire,
  maxAlertWakesPerHour,
  wakeAnswerOf,
} from "../alerts/alert-fire.js";
import {
  type AlertQuery,
  type AlertRecord,
  maxActiveAlerts,
  maxTrackedWallets,
} from "../alerts/alert-record.js";
import type { AlertStore } from "../alerts/ports.js";
import type { AgentStore } from "../ports.js";
import type { MemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";

/** The agents an in-memory alert store knows, and the inbox its fires store wake-ups in. */
export interface MemoryAlertStoreOptions {
  readonly agents: Pick<AgentStore, "get">;
  readonly agentInbox: Pick<MemoryAgentInboxStore, "wakeNow" | "replaceNow">;
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

function matches(alert: AlertRecord, query: AlertQuery): boolean {
  const { after } = query;
  return (
    query.states.includes(alert.state) &&
    (query.agentId === undefined || alert.agentId === query.agentId) &&
    (query.kind === undefined || alert.condition.kind === query.kind) &&
    (after === undefined ||
      alert.createdAtMs > after.createdAtMs ||
      (alert.createdAtMs === after.createdAtMs && alert.id > after.id))
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

// The accounts the install tracks for wallet alerts: those of its active wallet alerts.
function trackedAccounts(rows: Rows): ReadonlySet<string> {
  return new Set(
    activeOf(rows).flatMap(({ condition }) =>
      condition.kind === "wallet" ? [condition.account] : [],
    ),
  );
}

function create(rows: Rows, alert: AlertRecord): Result<AlertRecord, "too_many" | "track_limit"> {
  if (rows.alerts.has(alert.id)) {
    throw constraintFault(`the alert id ${alert.id} is in use`);
  }
  const held = activeOf(rows).filter(({ agentId }) => agentId === alert.agentId);
  if (held.length >= maxActiveAlerts) {
    return err("too_many");
  }
  const tracked = trackedAccounts(rows);
  const { condition } = alert;
  if (
    condition.kind === "wallet" &&
    !tracked.has(condition.account) &&
    tracked.size >= maxTrackedWallets
  ) {
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
    alert.lastMessageId === undefined
      ? undefined
      : inbox.replaceNow(alert.lastMessageId, wake.payload);
  return waiting === undefined
    ? newWake(rows, inbox, { alert, wake, atMs })
    : { outcome: "replaced", message: waiting };
}

// Keeps the fire's row, and forgets the rows older than a week.
function keep(rows: Rows, draft: AlertFireDraft, row: FireRow): void {
  for (const [key, kept] of rows.fires) {
    if (kept.atMs < draft.atMs - alertFireKeepMs) {
      rows.fires.delete(key);
    }
  }
  rows.fires.set(`${draft.id}:${String(draft.expectedFires)}`, row);
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
  const after = alertAfterFire(alert, draft.atMs);
  const lastMessage = "message" in wake ? { lastMessageId: wake.message.id } : {};
  return ok({ alert: put(rows, { ...after, ...lastMessage }), ...wakeAnswerOf(wake, wakeSkipped) });
}

function end(rows: Rows, atMs: number, limit: number): readonly AlertRecord[] {
  const due = activeOf(rows)
    .filter(({ expiresAtMs }) => expiresAtMs !== undefined && expiresAtMs <= atMs)
    .toSorted((left, right) => (left.expiresAtMs ?? 0) - (right.expiresAtMs ?? 0))
    .slice(0, limit);
  return due.map((alert) => put(rows, { ...alert, state: "ended", changedAtMs: atMs }));
}

/** Creates an empty in-memory {@link AlertStore} for tests. */
export function createMemoryAlertStore(options: MemoryAlertStoreOptions): AlertStore {
  const rows: Rows = { alerts: new Map(), fires: new Map() };
  return {
    async create(alert, call) {
      call.signal.throwIfAborted();
      const agent = await options.agents.get(alert.agentId, call);
      return agent === undefined ? err("not_found") : create(rows, alert);
    },
    get: async (id, call) => memoryCall(call, () => structuredClone(rows.alerts.get(id))),
    list: async (query, call) => memoryCall(call, () => structuredClone(listed(rows, query))),
    delete: async ({ id, atMs }, call) =>
      memoryCall(call, () => {
        const stored = rows.alerts.get(id);
        return stored?.state === "active"
          ? put(rows, { ...stored, state: "deleted", changedAtMs: atMs })
          : undefined;
      }),
    expire: async ({ atMs, limit }, call) => memoryCall(call, () => end(rows, atMs, limit)),
    fire: async (draft, call) => memoryCall(call, () => fire(rows, options.agentInbox, draft)),
  };
}
