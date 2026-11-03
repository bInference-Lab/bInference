import { describe, expect, it } from "vitest";
import type { PlantedPair } from "../contracts/order-fixtures.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import type { WebhookRuleStoreSubject } from "../contracts/webhook-rule-fixtures.js";
import { webhookRuleStoreContract } from "../contracts/webhook-rule-store-contract.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";

// Every engine store in memory, with two agents that each hold one wallet.
async function subjectOf(): Promise<WebhookRuleStoreSubject> {
  const { webhookRules, webhookAlerts, intents, agents, install } = createMemoryEngineStores();
  const plant = async (n: number): Promise<PlantedPair> => {
    const pair = { agentId: fixtureId("agt", n), walletId: fixtureId("wal", n) };
    install.addWallet(
      testWalletRecord({ id: pair.walletId, ...pair, label: "main", createdAtMs: 1 }),
    );
    await agents.create(testAgentDraft({ id: pair.agentId, name: `agent ${String(n)}` }), live());
    return pair;
  };
  const [mine, other] = await Promise.all([plant(1), plant(2)]);
  return { store: webhookRules, alerts: webhookAlerts, intents, agents, ...mine, other };
}

describe("memory webhook rule store", () => {
  it.each(webhookRuleStoreContract({ create: subjectOf }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
