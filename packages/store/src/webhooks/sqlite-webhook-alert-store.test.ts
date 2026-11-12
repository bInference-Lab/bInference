import type { WebhookRuleKey } from "@binference/engine/orders";
import { webhookAlertStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { webhookAlertSubject } from "../testing/engine-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";

const databases = createTestDatabases();
const live = { signal: new AbortController().signal };
afterAll(() => {
  databases.closeAll();
});

async function openStore() {
  const { host, database } = databases.open(engineDatabase);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  return { ...(await webhookAlertSubject(host)), kysely, execute };
}

describe("sqlite webhook alert store", () => {
  it.each(webhookAlertStoreContract({ create: openStore }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("takes two identical alerts at once as one accepted and one repeat", async () => {
    const { alerts, ...subject } = await openStore();
    const rule: WebhookRuleKey = {
      id: "whr_0190f1c2-3a4b-7c5d-8e6f-000000000001" as WebhookRuleKey["id"],
      secretHash: "a".repeat(64) as WebhookRuleKey["secretHash"],
      state: "active",
      ratePerMinute: 60,
    };
    await subject.plant(rule);
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
    const { alerts, kysely, execute, ...subject } = await openStore();
    const rule: WebhookRuleKey = {
      id: "whr_0190f1c2-3a4b-7c5d-8e6f-000000000001" as WebhookRuleKey["id"],
      secretHash: "a".repeat(64) as WebhookRuleKey["secretHash"],
      state: "active",
      ratePerMinute: 1,
    };
    await subject.plant(rule);
    const alert = { rule: rule.id, secretHash: rule.secretHash, body: { text: "buy" } };
    const body = "b".repeat(64) as WebhookRuleKey["secretHash"];
    await alerts.take({ ...alert, bodyHash: body, receivedAtMs: 5_000 }, live);
    await alerts.take({ ...alert, bodyHash: body, receivedAtMs: 6_000 }, live);
    const lastAt = (): number | null | undefined =>
      execute(kysely.selectFrom("webhook_rules").select("last_alert_at")).rows[0]?.last_alert_at;
    expect(lastAt()).toBe(5_000);
  });

  it("refuses an alert's end that breaks its row: a skip with no reason, notices that are not JSON", async () => {
    const { alerts, kysely, execute, ...subject } = await openStore();
    const rule: WebhookRuleKey = {
      id: "whr_0190f1c2-3a4b-7c5d-8e6f-000000000001" as WebhookRuleKey["id"],
      secretHash: "a".repeat(64) as WebhookRuleKey["secretHash"],
      state: "active",
      ratePerMinute: 5,
    };
    await subject.plant(rule);
    const bodyHash = "b".repeat(64) as WebhookRuleKey["secretHash"];
    const alert = { rule: rule.id, secretHash: rule.secretHash, body: { text: "buy" }, bodyHash };
    expect((await alerts.take({ ...alert, receivedAtMs: 5_000 }, live)).kind).toBe("accepted");
    const end = (set: Readonly<Record<string, string | number>>) => () =>
      execute(kysely.updateTable("webhook_events").set(set).where("rule_id", "=", rule.id));
    expect(end({ fill_outcome: "skipped" })).toThrow("CHECK");
    expect(end({ fill_outcome: "filled" })).toThrow("CHECK");
    expect(end({ fill_reason: "late" })).toThrow("CHECK");
    expect(end({ fill_outcome: "skipped", fill_reason: "Late!" })).toThrow("CHECK");
    expect(end({ fill_outcome: "skipped", fill_reason: "late", notices: "{" })).toThrow("CHECK");
    expect(end({ announced_at: 6_000 })).toThrow("CHECK");
    expect(end({ engine_locked: 2 })).toThrow("CHECK");
    expect(end({ fill_outcome: "skipped", fill_reason: "late", notices: "[]" })).not.toThrow();
  });
});
