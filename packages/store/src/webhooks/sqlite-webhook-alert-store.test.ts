import type { WebhookRuleKey } from "@binference/engine/orders";
import { webhookAlertStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { createSqliteInboxStore } from "../ingress/sqlite-inbox-store.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteWebhookAlertStore } from "./sqlite-webhook-alert-store.js";

const databases = createTestDatabases();
const live = { signal: new AbortController().signal };
afterAll(() => {
  databases.closeAll();
});

function ruleRow(rule: WebhookRuleKey, agentId: string) {
  return {
    id: rule.id,
    agent_id: agentId,
    name: "breakout",
    secret_hash: rule.secretHash,
    action: "{}",
    state: rule.state,
    rate_per_min: rule.ratePerMinute,
    last_alert_at: null,
    max_fills: null,
    expires_at: rule.expiresAtMs ?? null,
    card_id: null,
    created_at: 1,
    changed_at: 1,
  };
}

function openStore() {
  const { host, database } = databases.open(engineDatabase);
  const { agentId } = plantAgent(database, 1);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const plant = async (rule: WebhookRuleKey): Promise<void> => {
    const row = ruleRow(rule, agentId);
    execute(
      kysely
        .insertInto("webhook_rules")
        .values(row)
        .onConflict((conflict) => conflict.column("id").doUpdateSet(row)),
    );
    await Promise.resolve();
  };
  const alerts = createSqliteWebhookAlertStore(host);
  return { alerts, inbox: createSqliteInboxStore(host), plant, database, kysely, execute };
}

describe("sqlite webhook alert store", () => {
  it.each(webhookAlertStoreContract({ create: async () => Promise.resolve(openStore()) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("takes two identical alerts at once as one accepted and one repeat", async () => {
    const { alerts, plant } = openStore();
    const rule: WebhookRuleKey = {
      id: "whr_0190f1c2-3a4b-7c5d-8e6f-000000000001" as WebhookRuleKey["id"],
      secretHash: "a".repeat(64) as WebhookRuleKey["secretHash"],
      state: "active",
      ratePerMinute: 60,
    };
    await plant(rule);
    const draft = {
      rule: rule.id,
      secretHash: rule.secretHash,
      body: { text: "buy" },
      bodyHash: "b".repeat(64) as WebhookRuleKey["secretHash"],
      receivedAtMs: 5_000,
    };
    const taken = await Promise.all([alerts.take(draft, live), alerts.take(draft, live)]);
    expect(taken.map((outcome) => outcome.kind).toSorted()).toStrictEqual(["accepted", "repeat"]);
  });

  it("keeps the last accepted alert's time on its rule", async () => {
    const { alerts, plant, kysely, execute } = openStore();
    const rule: WebhookRuleKey = {
      id: "whr_0190f1c2-3a4b-7c5d-8e6f-000000000001" as WebhookRuleKey["id"],
      secretHash: "a".repeat(64) as WebhookRuleKey["secretHash"],
      state: "active",
      ratePerMinute: 1,
    };
    await plant(rule);
    const alert = { rule: rule.id, secretHash: rule.secretHash, body: { text: "buy" } };
    const body = "b".repeat(64) as WebhookRuleKey["secretHash"];
    await alerts.take({ ...alert, bodyHash: body, receivedAtMs: 5_000 }, live);
    await alerts.take({ ...alert, bodyHash: body, receivedAtMs: 6_000 }, live);
    const lastAt = (): number | null | undefined =>
      execute(kysely.selectFrom("webhook_rules").select("last_alert_at")).rows[0]?.last_alert_at;
    expect(lastAt()).toBe(5_000);
  });
});
