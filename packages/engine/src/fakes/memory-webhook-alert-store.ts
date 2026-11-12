import { refuseNulText } from "@binference/core";
import type { InboxStore } from "../ingress/ports.js";
import type { WebhookAlertStore } from "../webhooks/ports.js";
import {
  isAnswering,
  type WebhookAlertDraft,
  webhookInboxKey,
  webhookInboxPayload,
  webhookRateWindowMs,
  webhookRepeatWindowMs,
  type WebhookRuleKey,
  type WebhookTake,
} from "../webhooks/webhook-alert.js";
import { memoryCall } from "./memory-call.js";

/** One alert the in-memory store recorded. */
export interface MemoryEventRow {
  readonly id: number;
  readonly draft: WebhookAlertDraft;
  readonly outcome: "accepted" | "repeat" | "rate";
}

/** An in-memory {@link WebhookAlertStore} whose rules a test plants. */
export interface MemoryWebhookAlertStore extends WebhookAlertStore {
  /** Stores a rule as its operations would, in place of one with the same id. */
  plant(rule: WebhookRuleKey): void;
  /** The alerts it holds now, oldest first, which the rule store beside it reads. */
  eventsNow(): readonly MemoryEventRow[];
}

function isRepeat(event: MemoryEventRow, draft: WebhookAlertDraft): boolean {
  return (
    event.draft.bodyHash === draft.bodyHash ||
    (draft.alertId !== undefined && event.draft.alertId === draft.alertId)
  );
}

function outcomeOf(
  rule: WebhookRuleKey,
  draft: WebhookAlertDraft,
  events: readonly MemoryEventRow[],
): MemoryEventRow["outcome"] {
  const accepted = events.filter(
    (event) => event.draft.rule === draft.rule && event.outcome === "accepted",
  );
  const since = (windowMs: number) =>
    accepted.filter((event) => event.draft.receivedAtMs > draft.receivedAtMs - windowMs);
  if (since(webhookRepeatWindowMs).some((event) => isRepeat(event, draft))) {
    return "repeat";
  }
  return since(webhookRateWindowMs).length >= rule.ratePerMinute ? "rate" : "accepted";
}

// The row an alert gets, numbered `id`, or `undefined` when its rule no longer answers.
function rowOf(
  rule: WebhookRuleKey | undefined,
  draft: WebhookAlertDraft,
  past: { readonly events: readonly MemoryEventRow[]; readonly id: number },
): MemoryEventRow | undefined {
  if (
    rule === undefined ||
    rule.secretHash !== draft.secretHash ||
    !isAnswering(rule, draft.receivedAtMs)
  ) {
    return undefined;
  }
  return { id: past.id, draft, outcome: outcomeOf(rule, draft, past.events) };
}

function takeOf(row: MemoryEventRow | undefined): WebhookTake {
  if (row === undefined) {
    return { kind: "gone" };
  }
  return row.outcome === "accepted"
    ? { kind: "accepted", event: row.id, entry: 0 }
    : { kind: row.outcome, event: row.id };
}

/**
 * Creates an empty in-memory {@link WebhookAlertStore} for tests: an accepted alert's entry goes
 * into `inbox`, as the SQLite store writes it in the same transaction.
 */
export function createMemoryWebhookAlertStore(options: {
  readonly inbox: InboxStore;
}): MemoryWebhookAlertStore {
  const rules = new Map<string, WebhookRuleKey>();
  let events: readonly MemoryEventRow[] = [];
  let lastEvent = 0;
  const record = (draft: WebhookAlertDraft): WebhookTake => {
    refuseNulText(draft, "The webhook alert");
    const row = rowOf(rules.get(draft.rule), draft, { events, id: lastEvent + 1 });
    if (row !== undefined) {
      lastEvent = row.id;
      events = [...events, row];
    }
    return takeOf(row);
  };
  return {
    plant(rule) {
      rules.set(rule.id, structuredClone(rule));
    },
    eventsNow: () => events,
    findRule: async (id, call) =>
      memoryCall(call, () => {
        const rule = rules.get(id);
        return rule === undefined ? undefined : structuredClone(rule);
      }),
    take: async (draft, call) => {
      const taken = await memoryCall(call, () => record(structuredClone(draft)));
      if (taken.kind !== "accepted") {
        return taken;
      }
      const admitted = await options.inbox.admit(
        {
          source: "webhook",
          sourceKey: webhookInboxKey(taken.event),
          payload: webhookInboxPayload(draft, taken.event),
          receivedAtMs: draft.receivedAtMs,
        },
        call,
      );
      return { ...taken, entry: admitted.entry.id };
    },
    prune: async (beforeMs, call) =>
      memoryCall(call, () => {
        const kept = events.filter((event) => event.draft.receivedAtMs >= beforeMs);
        const pruned = events.length - kept.length;
        events = kept;
        return pruned;
      }),
  };
}
