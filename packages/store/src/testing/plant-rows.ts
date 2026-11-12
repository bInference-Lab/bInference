// Test tasks that write rows no store port writes the way a contract case needs them, so a
// store's subject plants them through its host on SQLite and Postgres alike. Nothing in
// production uses this file.
import { type Id, idSchema } from "@binference/core";
import { type WebhookRuleKey, webhookRuleKeySchema } from "@binference/engine/orders";
import type { CardVersionKey } from "@binference/engine/testing";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import type { StoreHost } from "../tasks/store-host.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

function call(): { readonly signal: AbortSignal } {
  return { signal: AbortSignal.timeout(30_000) };
}

/** Archives an agent straight in its row, as no store port does. */
export const archiveAgentTask: StoreTask<Id<"agt">, null> = defineTask({
  name: "testing.archive_agent",
  access: "write",
  input: idSchema("agt"),
  output: z.null(),
  run(database, agent) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(kysely.updateTable("agents").set({ archived_at: 1 }).where("id", "=", agent));
    return null;
  },
});

interface PlantedRule {
  readonly rule: WebhookRuleKey;
  readonly agentId: Id<"agt">;
}

/** Stores a webhook rule of an agent in place of one with the same id. */
export const plantWebhookRuleTask: StoreTask<PlantedRule, null> = defineTask({
  name: "testing.plant_webhook_rule",
  access: "write",
  input: z.strictObject({ rule: webhookRuleKeySchema, agentId: idSchema("agt") }),
  output: z.null(),
  run(database, { rule, agentId }) {
    const row = {
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
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .insertInto("webhook_rules")
        .values(row)
        .onConflict((conflict) => conflict.column("id").doUpdateSet(row)),
    );
    return null;
  },
});

/** Stores a card of each version, numbered from 1, for intents the store already holds. */
export const plantCardsTask: StoreTask<readonly CardVersionKey[], null> = defineTask({
  name: "testing.plant_cards",
  access: "write",
  input: z.array(
    z.object({ ref: z.string(), intent: idSchema("int"), cardVersion: z.int().positive() }),
  ),
  output: z.null(),
  run(database, cards) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    cards.forEach((card, index) => {
      execute(
        kysely.insertInto("cards").values({
          id: `crd_0190f1c2-3a4b-7c5d-8e6f-${String(index + 1).padStart(12, "0")}`,
          intent_id: card.intent,
          version: card.cardVersion,
          terms_hash: "a".repeat(64),
          callback_ref: card.ref,
          opened_at: 1,
          expires_at: 2,
          closed_at: null,
          close_reason: null,
        }),
      );
    });
    return null;
  },
});

/** Archives an agent through `host`. */
export async function archiveAgentOn(host: StoreHost, agent: Id<"agt">): Promise<void> {
  await host.run(archiveAgentTask, agent, call());
}

/** Stores a webhook rule of `agentId` through `host`, in place of one with the same id. */
export async function plantWebhookRuleOn(
  host: StoreHost,
  agentId: Id<"agt">,
  rule: WebhookRuleKey,
): Promise<void> {
  await host.run(plantWebhookRuleTask, { rule, agentId }, call());
}

/** Stores the card versions through `host`. */
export async function plantCardsOn(
  host: StoreHost,
  cards: readonly CardVersionKey[],
): Promise<void> {
  await host.run(plantCardsTask, cards, call());
}
