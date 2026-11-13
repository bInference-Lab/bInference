import { describe, expect, it } from "vitest";
import { quotaSourceContract } from "../contracts/quota-source-contract.js";
import { live } from "../contracts/store-fixtures.js";
import { noQuotas } from "../quotas/no-quotas.js";
import { createMemoryQuotaSource } from "./memory-quota-source.js";

const someQuotas = { agents: 3, liveAgents: 1, proposalsPerMinute: 0 };

describe("memory quota source", () => {
  it.each(quotaSourceContract({ create: async () => createMemoryQuotaSource(someQuotas) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("answers the quotas a test puts in force from the next read on", async () => {
    const source = createMemoryQuotaSource(someQuotas);
    await expect(source.read(live())).resolves.toStrictEqual(someQuotas);
    source.set({ openOrders: 50 });
    await expect(source.read(live())).resolves.toStrictEqual({ openOrders: 50 });
  });

  it("refuses quotas that are not whole numbers of at least 0", () => {
    expect(() => createMemoryQuotaSource({ agents: -1 })).toThrow(/>=0/u);
    expect(() => createMemoryQuotaSource({ turnsPerMinute: 1.5 })).toThrow(/int/u);
  });
});

describe("no quotas", () => {
  it.each(quotaSourceContract({ create: async () => Promise.resolve(noQuotas) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("holds no quota", async () => {
    await expect(noQuotas.read(live())).resolves.toStrictEqual({});
  });
});
