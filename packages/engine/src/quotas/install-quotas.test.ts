import { createManualClock } from "@binference/core/testing";
import { describe, expect, it, vi } from "vitest";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryModelUsageStore } from "../fakes/memory-model-usage-store.js";
import { createMemoryQuotaSource } from "../fakes/memory-quota-source.js";
import type { CreatedIntent } from "../intents/created-intent.js";
import { testAgent, testAgentDraft, testNowMs } from "../intents/test-intents.js";
import type { IntentStore } from "../ports.js";
import { createInstallQuotas } from "./install-quotas.js";
import type { Quotas } from "./quotas.js";
import { rateWindowMs } from "./rate-room.js";

const kinds = { swap: "swap", revoke: "revokeApproval", rescue: "rescue" } as const;

function stored(n: number, change: Partial<CreatedIntent> = {}): CreatedIntent {
  return {
    intentId: fixtureId("int", n),
    kind: kinds.swap,
    proposer: fixtureId("tok", 1),
    createdAtMs: testNowMs - 30_000 + n,
    ...change,
  };
}

async function quotasOver(quotas: Quotas, intents: readonly CreatedIntent[] = []) {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), live());
  const usage = createMemoryModelUsageStore({ agents });
  const createdSince = vi.fn<IntentStore["createdSince"]>(async () => Promise.resolve(intents));
  const clock = createManualClock(testNowMs);
  const source = createMemoryQuotaSource(quotas);
  const checks = createInstallQuotas({ source, intents: { createdSince }, usage, clock });
  return { checks, createdSince, usage, clock };
}

function charge(turn: number, n: number, atMs: number) {
  const id = fixtureId("trn", turn);
  const base = { agent: testAgent, turn: id, key: `${id}.usage.${String(n)}`, model: "m" };
  return { ...base, inputTokens: 1, outputTokens: 1, cachedTokens: 0, usdMicros: 1n, atMs };
}

const proposal = { agent: testAgent, kind: kinds.swap };

describe("the install's proposal quota", () => {
  it("lets a proposal in while fewer than the quota were proposed in the last minute", async () => {
    const { checks } = await quotasOver({ proposalsPerMinute: 2 }, [stored(1)]);
    await expect(checks.proposing(proposal, live())).resolves.toStrictEqual({
      proposalsPerMinute: 2,
    });
  });

  it("refuses one past the quota, retryable, naming when one more fits", async () => {
    const { checks } = await quotasOver({ proposalsPerMinute: 2 }, [stored(1), stored(2)]);
    await expect(checks.proposing(proposal, live())).rejects.toMatchObject({
      code: "quota.proposals",
      retryable: true,
      details: { agent: testAgent, resumesAt: stored(1).createdAtMs + rateWindowMs },
    });
  });

  it("counts no fill, rescue, unfreeze or revoke", async () => {
    const left = [
      stored(1, { proposer: "engine" }),
      stored(2, { kind: kinds.rescue }),
      stored(3, { kind: "unfreeze" }),
      stored(4, { kind: kinds.revoke }),
    ];
    const { checks } = await quotasOver({ proposalsPerMinute: 1 }, left);
    await expect(checks.proposing(proposal, live())).resolves.toBeDefined();
  });

  it("never refuses a revoke, a rescue or an unfreeze", async () => {
    const { checks, createdSince } = await quotasOver({ proposalsPerMinute: 0 }, [stored(1)]);
    for (const kind of [kinds.revoke, kinds.rescue, "unfreeze"] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one kind after another
      await expect(checks.proposing({ ...proposal, kind }, live())).resolves.toBeDefined();
    }
    expect(createdSince).not.toHaveBeenCalled();
  });

  it("reads the agent's intents of the last minute only", async () => {
    const { checks, createdSince } = await quotasOver({ proposalsPerMinute: 5 });
    await checks.proposing(proposal, live());
    expect(createdSince).toHaveBeenCalledWith(
      { agentId: testAgent, fromMs: testNowMs - rateWindowMs + 1 },
      expect.anything(),
    );
  });

  it("counts nothing while the source holds no proposal quota", async () => {
    const { checks, createdSince } = await quotasOver({ agents: 3 }, [stored(1)]);
    await expect(checks.proposing(proposal, live())).resolves.toStrictEqual({ agents: 3 });
    expect(createdSince).not.toHaveBeenCalled();
  });
});

describe("the install's turn quota", () => {
  it("counts a turn of eight model calls once", async () => {
    const { checks, usage } = await quotasOver({ turnsPerMinute: 2 });
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the calls land in their order
      await usage.record(charge(1, n, testNowMs - 20_000 + n), live());
    }
    await expect(checks.starting(testAgent, live())).resolves.toBeUndefined();
  });

  it("refuses a start past the quota, retryable, when the oldest turn's last call leaves", async () => {
    const { checks, usage } = await quotasOver({ turnsPerMinute: 2 });
    await usage.record(charge(1, 1, testNowMs - 50_000), live());
    await usage.record(charge(1, 2, testNowMs - 40_000), live());
    await usage.record(charge(2, 1, testNowMs - 10_000), live());
    await expect(checks.starting(testAgent, live())).rejects.toMatchObject({
      code: "quota.turns",
      retryable: true,
      details: { agent: testAgent, resumesAt: testNowMs - 40_000 + rateWindowMs },
    });
  });

  it("forgets the turns whose calls are older than a minute", async () => {
    const { checks, usage, clock } = await quotasOver({ turnsPerMinute: 1 });
    await usage.record(charge(1, 1, testNowMs - 1), live());
    await clock.advance(rateWindowMs);
    await expect(checks.starting(testAgent, live())).resolves.toBeUndefined();
  });

  it("reads no model calls while the source holds no turn quota", async () => {
    const { checks, usage } = await quotasOver({});
    const turnsSince = vi.spyOn(usage, "turnsSince");
    await expect(checks.starting(testAgent, live())).resolves.toBeUndefined();
    expect(turnsSince).not.toHaveBeenCalled();
  });
});
