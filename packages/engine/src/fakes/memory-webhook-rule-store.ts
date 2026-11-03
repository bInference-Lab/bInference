import { err, type Id, ok, type Result } from "@binference/core";
import type { StoredConfirmation } from "../intents/confirmation-record.js";
import type { Sha256Hex } from "../records/sha256-hex.js";
import type {
  AlertAnnouncement,
  AlertFillRecord,
  AlertFillWrite,
} from "../webhooks/alert-fill-record.js";
import type { WebhookRuleStore } from "../webhooks/ports.js";
import {
  maxWebhookRulesPerAgent,
  type WebhookRuleCreateRefusal,
  type WebhookRuleDraft,
  type WebhookRuleMove,
  type WebhookRuleMoveRefusal,
  type WebhookRuleQuery,
  type WebhookRuleRecord,
} from "../webhooks/webhook-rule-record.js";
import type { MemoryAgentStore } from "./memory-agent-store.js";
import { byCreation, constraintFault, memoryCall } from "./memory-call.js";
import type { MemoryInstallStore } from "./memory-install-store.js";
import type { MemoryEventRow, MemoryWebhookAlertStore } from "./memory-webhook-alert-store.js";

/** What the in-memory rule store reads beside it: agents, wallets, confirmations and alerts. */
export interface MemoryWebhookRuleStoreOptions {
  readonly agents: Pick<MemoryAgentStore, "agentNow">;
  readonly install: Pick<MemoryInstallStore, "walletNow">;
  /** The confirmation an intent holds, as the intent store beside it keeps it. */
  readonly confirmation: (intent: Id<"int">) => StoredConfirmation | undefined;
  /** The alert store whose URLs the rules answer, and whose alerts they fill. */
  readonly alerts: MemoryWebhookAlertStore;
}

/** An in-memory {@link WebhookRuleStore}, which the intent store beside it writes fills through. */
export interface MemoryWebhookRuleStore extends WebhookRuleStore {
  /**
   * Checks a fill's write on its alert and rule before the intent store writes anything: `stale`
   * when the alert ended or its rule moved; a broken write throws `store.constraint`.
   */
  checkFillNow(write: AlertFillWrite): Result<undefined, "stale">;
  /** Writes a fill's alert and rule, as the intent store's move writes them. */
  saveFillNow(write: AlertFillWrite): void;
  /** Stores a rule as no operation could, in place of one with the same id: a test's live rule. */
  plant(record: WebhookRuleRecord, secretHash: Sha256Hex): void;
}

interface Rule {
  readonly record: WebhookRuleRecord;
  readonly secretHash: Sha256Hex;
}

type Ended = Pick<AlertFillRecord, "outcome" | "reason" | "intentId" | "notices" | "announcedAtMs">;

interface State {
  readonly options: MemoryWebhookRuleStoreOptions;
  readonly rules: Map<Id<"whr">, Rule>;
  readonly ended: Map<number, Ended>;
}

function alertOf(row: MemoryEventRow, end: Ended | undefined): AlertFillRecord {
  const { draft } = row;
  return structuredClone({
    event: row.id,
    ruleId: draft.rule,
    ...(draft.alertId === undefined ? {} : { alertId: draft.alertId }),
    receivedAtMs: draft.receivedAtMs,
    wasEngineLocked: draft.isEngineLocked === true,
    ...end,
  });
}

// Keeps the rule, and plants its key where the listener reads it, as the SQLite row serves both.
function saveRule(state: State, rule: Rule): WebhookRuleRecord {
  state.rules.set(rule.record.id, structuredClone(rule));
  const { id, ratePerMinute, expiresAtMs } = rule.record;
  const key = { id, secretHash: rule.secretHash, state: rule.record.state, ratePerMinute };
  state.options.alerts.plant({ ...key, expiresAtMs });
  return structuredClone(rule.record);
}

function acceptedRow(state: State, event: number): MemoryEventRow | undefined {
  return state.options.alerts
    .eventsNow()
    .find((row) => row.id === event && row.outcome === "accepted");
}

function lastEventOf(state: State, rule: Id<"whr">): number {
  const ids = state.options.alerts
    .eventsNow()
    .filter(({ draft }) => draft.rule === rule)
    .map(({ id }) => id);
  return Math.max(0, ...ids);
}

function alertNow(state: State, event: number): AlertFillRecord | undefined {
  const row = acceptedRow(state, event);
  return row === undefined ? undefined : alertOf(row, state.ended.get(event));
}

function createRule(
  state: State,
  draft: WebhookRuleDraft,
): Result<WebhookRuleRecord, WebhookRuleCreateRefusal> {
  const agent = state.options.agents.agentNow(draft.agentId);
  const wallet = state.options.install.walletNow(draft.walletId);
  if (agent === undefined || wallet?.agentId !== draft.agentId) {
    throw constraintFault(`rule ${draft.id} names an unknown agent or another agent's wallet`);
  }
  if (state.rules.has(draft.id)) {
    return err("exists");
  }
  if (agent.frozenAtMs !== undefined) {
    return err("frozen");
  }
  const held = [...state.rules.values()].filter(
    ({ record }) => record.agentId === draft.agentId && record.state !== "deleted",
  );
  if (held.length >= maxWebhookRulesPerAgent) {
    return err("too_many");
  }
  const { atMs, secretHash, ...fields } = draft;
  const record: WebhookRuleRecord = {
    ...fields,
    state: "awaiting_confirmation",
    fills: 0,
    urlChangedAtMs: atMs,
    oldUrlLastEvent: 0,
    createdAtMs: atMs,
    changedAtMs: atMs,
    version: 0,
  };
  return ok(saveRule(state, { record, secretHash }));
}

function listRules(state: State, query: WebhookRuleQuery): readonly WebhookRuleRecord[] {
  return [...state.rules.values()]
    .map(({ record }) => record)
    .filter((record) => query.states.includes(record.state))
    .filter((record) => query.agentId === undefined || record.agentId === query.agentId)
    .toSorted(byCreation)
    .slice(0, query.limit)
    .map((record) => structuredClone(record));
}

// The rule after a move; a rotation keeps the last alert row its old URL took (decision 0337).
function movedOf(state: State, rule: Rule, move: WebhookRuleMove): Rule {
  const { cardId, fills, noticeHour, secretHash } = move;
  const record: WebhookRuleRecord = {
    ...rule.record,
    state: move.state,
    ...(cardId === undefined ? {} : { cardId }),
    ...(fills === undefined ? {} : { fills }),
    ...(noticeHour === undefined ? {} : { noticeHour }),
    ...(secretHash === undefined
      ? {}
      : { urlChangedAtMs: move.atMs, oldUrlLastEvent: lastEventOf(state, rule.record.id) }),
    changedAtMs: move.atMs,
    version: rule.record.version + 1,
  };
  return { record, secretHash: secretHash ?? rule.secretHash };
}

// A move into `active` needs the confirmation of the rule's card and an agent that is not frozen;
// a rule already active keeps its state while its agent is frozen (decision 0337).
function activeRefusal(
  state: State,
  rule: Rule,
  move: WebhookRuleMove,
): WebhookRuleMoveRefusal | undefined {
  if (move.state !== "active" || rule.record.state === "active") {
    return undefined;
  }
  const card = move.cardId ?? rule.record.cardId;
  if (card === undefined || state.options.confirmation(rule.record.intentId)?.cardId !== card) {
    return "not_confirmed";
  }
  const agent = state.options.agents.agentNow(rule.record.agentId);
  return agent?.frozenAtMs === undefined ? undefined : "frozen";
}

function checkMove(state: State, move: WebhookRuleMove): Result<Rule, WebhookRuleMoveRefusal> {
  const rule = state.rules.get(move.id);
  if (rule === undefined) {
    return err("not_found");
  }
  if (rule.record.state === "deleted") {
    throw constraintFault(`webhook rule ${move.id} was deleted and never moves again`);
  }
  if (rule.record.version !== move.expectedVersion) {
    return err("stale");
  }
  const refusal = activeRefusal(state, rule, move);
  return refusal === undefined ? ok(movedOf(state, rule, move)) : err(refusal);
}

type EndRefusal = "ended" | "not_found" | "stale";

function checkEnd(state: State, write: AlertFillWrite): Result<Rule | undefined, EndRefusal> {
  const row = acceptedRow(state, write.event);
  if (row === undefined) {
    return err("not_found");
  }
  if (state.ended.has(write.event)) {
    return err("ended");
  }
  if (write.move === undefined) {
    return ok(undefined);
  }
  if (write.move.id !== row.draft.rule) {
    throw constraintFault(`alert ${String(write.event)} is not of rule ${write.move.id}`);
  }
  const moved = checkMove(state, write.move);
  return moved.ok ? ok(moved.value) : err("stale");
}

function saveEnd(state: State, write: AlertFillWrite, rule: Rule | undefined): void {
  const { outcome, reason, intentId, notices } = write;
  state.ended.set(write.event, {
    outcome,
    ...(reason === undefined ? {} : { reason }),
    ...(intentId === undefined ? {} : { intentId }),
    ...(notices === undefined ? {} : { notices: structuredClone(notices) }),
  });
  if (rule !== undefined) {
    saveRule(state, rule);
  }
}

function endAlert(state: State, write: AlertFillWrite): Result<AlertFillRecord, EndRefusal> {
  if (write.outcome !== "skipped") {
    throw constraintFault("a fill ends its alert with its intent's move");
  }
  const checked = checkEnd(state, write);
  if (!checked.ok) {
    return checked;
  }
  saveEnd(state, write, checked.value);
  const now = alertNow(state, write.event);
  if (now === undefined) {
    throw constraintFault(`alert ${String(write.event)} did not read back`);
  }
  return ok(now);
}

function unannounced(state: State, limit: number): readonly AlertFillRecord[] {
  return state.options.alerts
    .eventsNow()
    .filter((row) => {
      const end = state.ended.get(row.id);
      return end?.notices !== undefined && end.announcedAtMs === undefined;
    })
    .slice(0, limit)
    .map((row) => alertOf(row, state.ended.get(row.id)));
}

function markAnnounced(state: State, { events, atMs }: AlertAnnouncement): void {
  events.forEach((event) => {
    const end = state.ended.get(event);
    if (end?.notices !== undefined && end.announcedAtMs === undefined) {
      state.ended.set(event, { ...end, announcedAtMs: atMs });
    }
  });
}

function checkFill(state: State, write: AlertFillWrite): Result<undefined, "stale"> {
  if (write.outcome !== "filled" || write.move === undefined) {
    throw constraintFault("a fill's write counts the fill on its rule");
  }
  const checked = checkEnd(state, write);
  if (!checked.ok && checked.error === "not_found") {
    throw constraintFault(`alert ${String(write.event)} is no accepted alert`);
  }
  return checked.ok ? ok(undefined) : err("stale");
}

function alertsOf(state: State, ruleId: Id<"whr">, limit: number): readonly AlertFillRecord[] {
  return state.options.alerts
    .eventsNow()
    .filter((row) => row.draft.rule === ruleId && row.outcome === "accepted")
    .toReversed()
    .slice(0, limit)
    .map((row) => alertOf(row, state.ended.get(row.id)));
}

function findByIntent(state: State, intent: Id<"int">): WebhookRuleRecord | undefined {
  const rule = [...state.rules.values()].find(({ record }) => record.intentId === intent);
  return rule === undefined ? undefined : structuredClone(rule.record);
}

/**
 * Creates an empty in-memory {@link WebhookRuleStore} for tests. It plants each rule it writes in
 * `alerts`, as the SQLite store's listener reads the same row, and checks every rule a write must
 * pass before it changes anything.
 */
export function createMemoryWebhookRuleStore(
  options: MemoryWebhookRuleStoreOptions,
): MemoryWebhookRuleStore {
  const state: State = { options, rules: new Map(), ended: new Map() };
  return {
    create: async (draft, call) => memoryCall(call, () => createRule(state, draft)),
    get: async (id, call) => memoryCall(call, () => structuredClone(state.rules.get(id)?.record)),
    byIntent: async (intent, call) => memoryCall(call, () => findByIntent(state, intent)),
    list: async (query, call) => memoryCall(call, () => listRules(state, query)),
    move: async (move, call) =>
      memoryCall(call, () => {
        const checked = checkMove(state, move);
        return checked.ok ? ok(saveRule(state, checked.value)) : checked;
      }),
    alert: async (event, call) => memoryCall(call, () => alertNow(state, event)),
    alerts: async ({ ruleId, limit }, call) =>
      memoryCall(call, () => alertsOf(state, ruleId, limit)),
    endAlert: async (write, call) => memoryCall(call, () => endAlert(state, write)),
    unannounced: async (limit, call) => memoryCall(call, () => unannounced(state, limit)),
    markAnnounced: async (announcement, call) =>
      memoryCall(call, () => markAnnounced(state, announcement)),
    checkFillNow: (write) => checkFill(state, write),
    plant: (record, secretHash) => {
      saveRule(state, { record, secretHash });
    },
    saveFillNow(write) {
      const checked = checkEnd(state, write);
      if (!checked.ok) {
        throw constraintFault(`alert ${String(write.event)} cannot take its fill`);
      }
      saveEnd(state, write, checked.value);
    },
  };
}
