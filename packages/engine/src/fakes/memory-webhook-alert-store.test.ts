import { describe, expect, it } from "vitest";
import { webhookAlertStoreContract } from "../contracts/webhook-alert-store-contract.js";
import { createMemoryInboxStore } from "./memory-inbox-store.js";
import { createMemoryWebhookAlertStore } from "./memory-webhook-alert-store.js";

describe("memory webhook alert store", () => {
  it.each(
    webhookAlertStoreContract({
      create: async () => {
        const inbox = createMemoryInboxStore();
        const alerts = createMemoryWebhookAlertStore({ inbox });
        return Promise.resolve({
          alerts,
          inbox,
          plant: async (rule) => {
            alerts.plant(rule);
            await Promise.resolve();
          },
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
