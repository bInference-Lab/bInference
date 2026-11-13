import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { BridgeStore } from "../bridges/ports.js";
import type { IdempotencyStore, InboxStore } from "../ingress/ports.js";
import type { AccessStore, AgentStore, InstallStore } from "../ports.js";
import type { DailySummaryStore } from "../summaries/ports.js";
import type { WebhookAlertStore, WebhookRuleStore } from "../webhooks/ports.js";
import type { WebhookRuleKey } from "../webhooks/webhook-alert.js";
import type { RacingWriters } from "./money-race-runs.js";
import type { PlantedPair } from "./order-fixtures.js";

// The writers the key races of the stores outside the money stores run on.

/** One writer of an install's engine database: the stores whose writes answer a key in use. */
export interface KeyRaceWriter {
  readonly access: AccessStore;
  readonly agents: AgentStore;
  readonly idempotency: IdempotencyStore;
  readonly inbox: InboxStore;
  readonly install: InstallStore;
  readonly bridges: BridgeStore;
  readonly summaries: DailySummaryStore;
  readonly rules: WebhookRuleStore;
  readonly webhookAlerts: WebhookAlertStore;
}

/**
 * Writers of one engine database that race, with agent 1 and its wallet, two intents of it, and a
 * planter of webhook rules. Each writer runs its own writes in order; the writers run at once.
 */
export interface KeyRaceSubject extends PlantedPair, RacingWriters<KeyRaceWriter> {
  readonly intentIds: readonly [Id<"int">, Id<"int">];
  /** Stores a rule of agent 1 as its operations would, in place of one with the same id. */
  plant(rule: WebhookRuleKey): Promise<void>;
}

/** Makes a fresh database with its racing writers for each check. */
export interface KeyRaceHarness {
  create(): Promise<KeyRaceSubject>;
}

/** The first writer, which sets a race up and reads its outcome. */
export function firstWriter(subject: KeyRaceSubject): KeyRaceWriter {
  const [writer] = subject.writers;
  assert.ok(writer !== undefined, "A race needs a writer.");
  return writer;
}
