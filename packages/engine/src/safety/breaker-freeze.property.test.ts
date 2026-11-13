import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  type BreakerFreezeSubject,
  breakerFreezeProperty,
} from "../contracts/breaker-freeze-property.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testAgentDraft, testNowMs, testWallet } from "../intents/test-intents.js";
import { startTestEngine } from "../operations/test-engine.js";

const live = { signal: new AbortController().signal };
const second = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");

// The in-memory stores of a test engine, with a second agent and the first agent's wallet.
async function memorySubject(): Promise<BreakerFreezeSubject> {
  const { stores } = await startTestEngine();
  await stores.agents.create(testAgentDraft({ id: second, name: "second" }), live);
  const wallet = { id: testWallet, agentId: testAgent, label: "main", createdAtMs: testNowMs };
  stores.install.addWallet(testWalletRecord(wallet));
  const { agents, intents, install, orders, transactions } = stores;
  return {
    agents,
    intents,
    install,
    orders,
    transactions,
    first: { agentId: testAgent, walletId: testWallet },
    second,
  };
}

describe("the owner's freeze and the breaker's hold, in memory", () => {
  it("never end each other, and the order is paused exactly while its agent is held", async () => {
    await expect(breakerFreezeProperty(memorySubject, 100)).resolves.toBeUndefined();
  });
});
