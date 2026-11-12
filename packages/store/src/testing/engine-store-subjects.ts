// The contract subjects of the engine stores outside the money stores, on a fresh engine
// database's host, planted through its tasks, so one setup serves each store's SQLite and
// Postgres tests. Nothing in production uses this file.
import {
  type AgentInboxSubject,
  type AlertSubject,
  type BridgeStoreSubject,
  type CardVersionKey,
  fixtureId,
  type InstallStoreSubject,
  type KeyRaceSubject,
  type KeyRaceWriter,
  type NoticeStoreSubject,
  type QuestionSubject,
  type RiskCacheStoreSubject,
  type ScheduleSubject,
  testAgent,
  testAgentDraft,
  type TrackedWalletSubject,
  type WebhookAlertSubject,
  type WebhookRuleStoreSubject,
} from "@binference/engine/testing";
import { createSqliteAccessStore } from "../access/sqlite-access-store.js";
import { createSqliteAgentInboxStore } from "../agent-inbox/sqlite-agent-inbox-store.js";
import { createSqliteQuestionStore } from "../agent-inbox/sqlite-question-store.js";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { createSqliteAlertStore } from "../alerts/sqlite-alert-store.js";
import { createSqliteBridgeStore } from "../bridges/sqlite-bridge-store.js";
import { createSqliteIdempotencyStore } from "../ingress/sqlite-idempotency-store.js";
import { createSqliteInboxStore } from "../ingress/sqlite-inbox-store.js";
import { createSqliteInstallStore } from "../install/sqlite-install-store.js";
import { createSqliteIntentStore } from "../intents/sqlite-intent-store.js";
import { createSqliteTrackedWalletStore } from "../leaders/sqlite-tracked-wallet-store.js";
import { createSqliteNoticeStore } from "../notices/sqlite-notice-store.js";
import { createSqliteRiskCacheStore } from "../risk-cache/sqlite-risk-cache-store.js";
import { createSqliteScheduleStore } from "../schedules/sqlite-schedule-store.js";
import { createSqliteDailySummaryStore } from "../summaries/sqlite-daily-summary-store.js";
import type { StoreHost } from "../tasks/store-host.js";
import { createSqliteWebhookAlertStore } from "../webhooks/sqlite-webhook-alert-store.js";
import { createSqliteWebhookRuleStore } from "../webhooks/sqlite-webhook-rule-store.js";
import { createIntent } from "./create-intent.js";
import { intentSubject } from "./money-store-subjects.js";
import { plantAgentOn } from "./plant-agent.js";
import { archiveAgentOn, plantCardsOn, plantWebhookRuleOn } from "./plant-rows.js";

function call(): { readonly signal: AbortSignal } {
  return { signal: AbortSignal.timeout(30_000) };
}

/**
 * Creates the contracts' agents 1 and 2 through the agent store, for the stores whose rows name
 * an agent the contract numbers, and returns `host` once they exist.
 */
export async function withTwoAgents(host: StoreHost): Promise<StoreHost> {
  const agents = createSqliteAgentStore(host);
  await agents.create(testAgentDraft({ id: fixtureId("agt", 1), name: "one" }), call());
  await agents.create(testAgentDraft({ id: fixtureId("agt", 2), name: "two" }), call());
  return host;
}

/** The agent inbox's subject: the intent store's, with the agent inbox. */
export async function agentInboxSubject(host: StoreHost): Promise<AgentInboxSubject> {
  return { ...(await intentSubject(host)), agentInbox: createSqliteAgentInboxStore(host) };
}

/** The question store's subject, with agent 1. */
export async function questionSubject(host: StoreHost): Promise<QuestionSubject> {
  return {
    questions: createSqliteQuestionStore(host),
    agentInbox: createSqliteAgentInboxStore(host),
    agentId: (await plantAgentOn(host, 1)).agentId,
  };
}

/** The alert store's subject: agents 1 and 2, and an archive that writes the agent's row. */
export async function alertSubject(host: StoreHost): Promise<AlertSubject> {
  const first = (await plantAgentOn(host, 1)).agentId;
  const second = (await plantAgentOn(host, 2)).agentId;
  return {
    alerts: createSqliteAlertStore(host),
    agentInbox: createSqliteAgentInboxStore(host),
    agentIds: [first, second],
    archive: async (agent) => archiveAgentOn(host, agent),
  };
}

/** The tracked wallet store's subject: the alert store's, with the tracked wallets. */
export async function trackedWalletSubject(host: StoreHost): Promise<TrackedWalletSubject> {
  return { ...(await alertSubject(host)), tracked: createSqliteTrackedWalletStore(host) };
}

/** The bridge store's subject: two intents of agent 1. */
export async function bridgeSubject(host: StoreHost): Promise<BridgeStoreSubject> {
  const agent = await plantAgentOn(host, 1);
  const intentIds = [
    await createIntent(host, agent, 1),
    await createIntent(host, agent, 2),
  ] as const;
  return { store: createSqliteBridgeStore(host), intentIds };
}

/** The install store's subject: the test agent, whose wallets are of the registry's family. */
export async function installSubject(host: StoreHost): Promise<InstallStoreSubject> {
  const draft = testAgentDraft();
  await createSqliteAgentStore(host).create(draft, call());
  return { store: createSqliteInstallStore(host), agent: draft.id, family: "evm" };
}

/** The notice store's subject: the test agent. */
export async function noticeSubject(host: StoreHost): Promise<NoticeStoreSubject> {
  await createSqliteAgentStore(host).create(testAgentDraft(), call());
  return { notices: createSqliteNoticeStore(host), agent: testAgent };
}

/** The risk cache's subject: the two sources the engine database keeps reports for. */
export function riskCacheSubject(host: StoreHost): RiskCacheStoreSubject {
  return {
    store: createSqliteRiskCacheStore(host),
    sources: ["goplus", "honeypot"],
    refused: "codex",
  };
}

/** The schedule store's subject, with agent 1. */
export async function scheduleSubject(host: StoreHost): Promise<ScheduleSubject> {
  return {
    schedules: createSqliteScheduleStore(host),
    agentInbox: createSqliteAgentInboxStore(host),
    agentId: (await plantAgentOn(host, 1)).agentId,
  };
}

/** Stores each card version, of an intent of agent 1 numbered by its id, for the card copies. */
export async function plantCardVersions(
  host: StoreHost,
  cards: readonly CardVersionKey[],
): Promise<void> {
  const agent = await plantAgentOn(host, 1);
  const intents = [...new Set(cards.map((card) => card.intent))];
  await intents.reduce<Promise<void>>(async (earlier, intent) => {
    await earlier;
    await createIntent(host, agent, Number.parseInt(intent.slice(-12), 16));
  }, Promise.resolve());
  await plantCardsOn(host, cards);
}

/** The webhook alert store's subject: rules of agent 1 planted through the host. */
export async function webhookAlertSubject(host: StoreHost): Promise<WebhookAlertSubject> {
  const { agentId } = await plantAgentOn(host, 1);
  return {
    alerts: createSqliteWebhookAlertStore(host),
    inbox: createSqliteInboxStore(host),
    plant: async (rule) => plantWebhookRuleOn(host, agentId, rule),
  };
}

/** The webhook rule store's subject: agents 1 and 2, and the stores a rule's fill writes beside. */
export async function webhookRuleSubject(host: StoreHost): Promise<WebhookRuleStoreSubject> {
  return {
    store: createSqliteWebhookRuleStore(host),
    alerts: createSqliteWebhookAlertStore(host),
    intents: createSqliteIntentStore(host),
    agents: createSqliteAgentStore(host),
    ...(await plantAgentOn(host, 1)),
    other: await plantAgentOn(host, 2),
  };
}

function keyRaceWriter(host: StoreHost): KeyRaceWriter {
  return {
    access: createSqliteAccessStore(host),
    agents: createSqliteAgentStore(host),
    idempotency: createSqliteIdempotencyStore(host),
    inbox: createSqliteInboxStore(host),
    install: createSqliteInstallStore(host),
    bridges: createSqliteBridgeStore(host),
    summaries: createSqliteDailySummaryStore(host),
    rules: createSqliteWebhookRuleStore(host),
    webhookAlerts: createSqliteWebhookAlertStore(host),
  };
}

/**
 * The key races' writers, one per host, all on one engine database, with agent 1, two intents of
 * it and its webhook rules planted through the first.
 */
export async function keyRaceSubject(hosts: readonly StoreHost[]): Promise<KeyRaceSubject> {
  const [first] = hosts;
  if (first === undefined) {
    throw new Error("A race needs a writer.");
  }
  const agent = await plantAgentOn(first, 1);
  const intentIds = [
    await createIntent(first, agent, 1),
    await createIntent(first, agent, 2),
  ] as const;
  return {
    writers: hosts.map((host) => keyRaceWriter(host)),
    ...agent,
    intentIds,
    plant: async (rule) => plantWebhookRuleOn(first, agent.agentId, rule),
  };
}
