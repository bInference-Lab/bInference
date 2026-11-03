import assert from "node:assert/strict";
import { bpsSchema, type Id } from "@binference/core";
import { testToken } from "../intents/test-intents.js";
import type { AgentStore, IntentStore } from "../ports.js";
import type { WebhookAlertStore, WebhookRuleStore } from "../webhooks/ports.js";
import type {
  WebhookRuleDraft,
  WebhookRuleMove,
  WebhookRuleRecord,
} from "../webhooks/webhook-rule-record.js";
import { confirmedCard, type PlantedPair } from "./order-fixtures.js";
import { fixtureHash, fixtureId, live } from "./store-fixtures.js";

/**
 * A webhook rule store under test, with the alert, intent and agent stores of the same database,
 * an agent at version 0 with its wallet, and another agent with its own wallet.
 */
export interface WebhookRuleStoreSubject extends PlantedPair {
  readonly store: WebhookRuleStore;
  readonly alerts: WebhookAlertStore;
  readonly intents: IntentStore;
  readonly agents: AgentStore;
  readonly other: PlantedPair;
}

/** A size past 64 bits, which every store keeps exact. */
const wideBase: bigint = 2n ** 64n + 1n;

/** When every fixture rule expires. */
const ruleExpiresAtMs = 90_000;

/** The secret hash of rule `n`'s URL. */
export function ruleSecretHash(n: number): ReturnType<typeof fixtureHash> {
  return fixtureHash(`webhook secret ${String(n)}`);
}

/** Rule `n` of the subject's agent: a sale of the fixture token, awaiting the card of intent `n`. */
export function ruleDraft(subject: PlantedPair, n: number): WebhookRuleDraft {
  return {
    id: fixtureId("whr", n),
    agentId: subject.agentId,
    walletId: subject.walletId,
    request: {
      agent: subject.agentId,
      wallet: subject.walletId,
      name: `rule ${String(n)}`,
      token: testToken,
      side: "sell",
      size: { base: wideBase },
      worstPrice: wideBase,
      maxSlippageBps: bpsSchema.parse(100),
      expiresAt: ruleExpiresAtMs,
      maxFills: 3,
      ratePerMinute: 5,
    },
    secretHash: ruleSecretHash(n),
    ratePerMinute: 5,
    maxFills: 3,
    expiresAtMs: ruleExpiresAtMs,
    intentId: fixtureId("int", n),
    isPaper: true,
    atMs: 100 * n,
  };
}

/** A move of rule `n` from `version` into `state`, at `1000 + version`. */
export function ruleMove(
  n: number,
  version: number,
  state: WebhookRuleMove["state"],
): WebhookRuleMove {
  return { id: fixtureId("whr", n), expectedVersion: version, state, atMs: 1_000 + version };
}

/** Rule `n`, stored and made active on its confirmed card, at version 1. */
export async function activeRule(
  subject: WebhookRuleStoreSubject,
  n: number,
): Promise<WebhookRuleRecord> {
  assert.ok((await subject.store.create(ruleDraft(subject, n), live())).ok);
  const cardId = await confirmedCard(subject, n);
  const moved = await subject.store.move({ ...ruleMove(n, 0, "active"), cardId }, live());
  assert.ok(moved.ok);
  return moved.value;
}

/** An alert rule `n`'s URL took at `atMs` with the body `text`, and its `webhook_events` row. */
export async function takenAlert(
  subject: WebhookRuleStoreSubject,
  rule: {
    readonly n: number;
    readonly atMs: number;
    readonly text: string;
    readonly isEngineLocked?: true;
  },
): Promise<{ readonly kind: string; readonly event?: number }> {
  const taken = await subject.alerts.take(
    {
      rule: fixtureId("whr", rule.n),
      secretHash: ruleSecretHash(rule.n),
      alertId: rule.text,
      body: { text: rule.text },
      bodyHash: fixtureHash(rule.text),
      receivedAtMs: rule.atMs,
      ...(rule.isEngineLocked === undefined ? {} : { isEngineLocked: rule.isEngineLocked }),
    },
    live(),
  );
  return taken.kind === "gone" ? taken : { kind: taken.kind, event: taken.event };
}

/** The `webhook_events` row of an accepted alert rule `n`'s URL took at `atMs`. */
export async function acceptedEvent(
  subject: WebhookRuleStoreSubject,
  rule: { readonly n: number; readonly atMs: number },
): Promise<number> {
  const taken = await takenAlert(subject, { ...rule, text: `alert at ${String(rule.atMs)}` });
  assert.equal(taken.kind, "accepted");
  assert.ok(taken.event !== undefined);
  return taken.event;
}

/** Rule `n`'s id. */
export function ruleId(n: number): Id<"whr"> {
  return fixtureId("whr", n);
}
