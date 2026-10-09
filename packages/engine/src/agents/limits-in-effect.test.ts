import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { agentStoreContract } from "../contracts/agent-store-contract.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { expectOk, testAgent, testAgentDraft, testLimits } from "../intents/test-intents.js";
import type { AgentStore } from "../ports.js";
import { withLimitsInEffect } from "./limits-in-effect.js";
import type { LimitsRecord } from "./limits-record.js";

const live = { signal: new AbortController().signal };
const atMs = 1_000_000;
const looser = { ...testLimits, perTradeUsdMicros: testLimits.perTradeUsdMicros * 2n };

async function limitsOf(store: AgentStore): Promise<LimitsRecord> {
  const settings = await store.get(testAgent, live);
  if (settings === undefined) {
    throw new Error("Expected the test agent.");
  }
  return settings.limits;
}

describe("the agent store with the limits in effect", () => {
  it.each(
    agentStoreContract({
      create: async () => withLimitsInEffect(createMemoryAgentStore(), createManualClock(0)),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("answers looser limits in place of the stored ones from their time, same version", async () => {
    const stored = createMemoryAgentStore();
    const clock = createManualClock(atMs - 1);
    const store = withLimitsInEffect(stored, clock);
    expectOk(await store.create(testAgentDraft(), live));
    const change = { agentId: testAgent, limits: testLimits, atMs: 1, expectedVersion: 0 };
    expectOk(await store.setLimits({ ...change, pending: { values: looser, atMs } }, live));

    const waiting = await limitsOf(store);
    await clock.advance(1);
    const applied = await limitsOf(store);

    expect([waiting.perTradeUsdMicros, waiting.pending]).toStrictEqual([
      testLimits.perTradeUsdMicros,
      { values: looser, atMs },
    ]);
    expect([applied.perTradeUsdMicros, applied.pending, applied.version]).toStrictEqual([
      looser.perTradeUsdMicros,
      undefined,
      1,
    ]);
    expect((await limitsOf(stored)).pending).toStrictEqual({ values: looser, atMs });
  });
});
