import type { Id } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { modelBillingContract } from "../contracts/model-billing-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryModelUsageStore } from "../fakes/memory-model-usage-store.js";
import { testAgent, testAgentDraft, testLimits } from "../intents/test-intents.js";
import { createDailyModelBudget } from "./daily-model-budget.js";
import type { ModelCharge } from "./model-charge.js";

const at = (iso: string): number => Date.parse(iso);
const turn = fixtureId("trn", 1);
const threeDollars = 3_000_000n;

// The daily budget over agents whose budgets are the allowances, in UTC, on the contract's day.
async function budgetOf(allowances: ReadonlyMap<Id<"agt">, bigint>) {
  const agents = createMemoryAgentStore();
  for (const [id, budget] of allowances) {
    const limits = { ...testLimits, modelBudgetUsdMicros: budget };
    // oxlint-disable-next-line eslint/no-await-in-loop -- the agents are stored one by one
    await agents.create(testAgentDraft({ id, name: id.slice(-4), limits }), live());
  }
  const usage = createMemoryModelUsageStore({ agents });
  const clock = createManualClock(1_800_000_000_000);
  return createDailyModelBudget({ usage, agents, timeZone: () => "UTC", clock });
}

/** The test agent's $3 budget in New York, on a clock the test moves. */
async function newYorkBudget(startIso: string) {
  const agents = createMemoryAgentStore();
  const limits = { ...testLimits, modelBudgetUsdMicros: threeDollars };
  await agents.create(testAgentDraft({ limits }), live());
  const usage = createMemoryModelUsageStore({ agents });
  const clock = createManualClock(at(startIso));
  const budget = createDailyModelBudget({
    usage,
    agents,
    timeZone: () => "America/New_York",
    clock,
  });
  let attempts = 0;
  const spend = async (usdMicros: bigint): Promise<bigint> => {
    attempts += 1;
    const charge: ModelCharge = {
      agent: testAgent,
      turn,
      key: `${turn}.usage.${String(attempts)}`,
      model: "anthropic/claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 10,
      cachedTokens: 0,
      usdMicros,
      atMs: clock.now(),
    };
    return budget.charge(charge, live());
  };
  return { budget, clock, spend };
}

describe("the daily model budget", () => {
  it.each(modelBillingContract({ create: budgetOf }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("is spent by the day's calls and comes back whole at the owner's midnight", async () => {
    const { budget, clock, spend } = await newYorkBudget("2026-10-12T23:00:00Z");
    await expect(spend(3_100_000n)).resolves.toBe(0n);
    await clock.advance(at("2026-10-13T03:59:59Z") - clock.now());
    await expect(budget.left(testAgent, live())).resolves.toBe(0n);
    await clock.advance(1_000);
    await expect(budget.left(testAgent, live())).resolves.toBe(threeDollars);
  });

  it("resets 23 hours after midnight on the day the clocks go forward", async () => {
    const { budget, clock, spend } = await newYorkBudget("2026-03-08T05:00:00Z");
    await expect(spend(threeDollars)).resolves.toBe(0n);
    await clock.advance(23 * 3_600_000 - 1);
    await expect(budget.left(testAgent, live())).resolves.toBe(0n);
    await clock.advance(1);
    await expect(budget.left(testAgent, live())).resolves.toBe(threeDollars);
  });

  it("resets 25 hours after midnight on the day the clocks go back", async () => {
    const { budget, clock, spend } = await newYorkBudget("2026-11-01T04:00:00Z");
    await expect(spend(threeDollars)).resolves.toBe(0n);
    await clock.advance(24 * 3_600_000);
    await expect(budget.left(testAgent, live())).resolves.toBe(0n);
    await clock.advance(3_600_000);
    await expect(budget.left(testAgent, live())).resolves.toBe(threeDollars);
  });

  it("counts yesterday's calls against yesterday only", async () => {
    const { budget, clock, spend } = await newYorkBudget("2026-10-13T03:30:00Z");
    await spend(2_000_000n);
    await clock.advance(3_600_000);
    await expect(spend(500_000n)).resolves.toBe(2_500_000n);
    await expect(budget.left(testAgent, live())).resolves.toBe(2_500_000n);
  });
});
