import { mulDiv } from "@binference/core";
import type { StakeRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testSnapshot } from "../approval/test-snapshot.js";
import { testCoin, testLimits, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import {
  stakedFake,
  stakeRequest,
  startStakeEngine,
  stakingSimulator,
  testMinStake,
  testStakingVenue,
} from "./test-stakes.js";

// Spec 6, invariant 18 (Z2), on the whole engine: no stake passes the per-trade or the rolling
// 24-hour cap, and no unstake or claim counts against either, whatever the day spent already.

const coinPrice = { numerator: 600n, denominator: 10n ** 12n };
const dollar = 1_000_000n;

interface Case {
  readonly action: StakeRequest["action"];
  readonly amountBase: bigint;
  readonly perTradeUsdMicros: bigint;
  readonly rollingDayUsdMicros: bigint;
  readonly spentUsdMicros: bigint;
}

const cases: fc.Arbitrary<Case> = fc.record({
  action: fc.constantFrom<StakeRequest["action"]>("stake", "unstake", "claim"),
  amountBase: fc.bigInt({ min: testMinStake, max: 9n * testMinStake }),
  perTradeUsdMicros: fc.bigInt({ min: 0n, max: 1_000n * dollar }),
  rollingDayUsdMicros: fc.bigInt({ min: 0n, max: 3_000n * dollar }),
  spentUsdMicros: fc.bigInt({ min: 0n, max: 2_000n * dollar }),
});

// What the policy refuses a stake for, in spec 6's order: none for an unstake or a claim.
function capRefusalOf(c: Case): string | undefined {
  if (c.action !== "stake") {
    return undefined;
  }
  const value = mulDiv(c.amountBase, coinPrice, "up");
  if (value > c.perTradeUsdMicros) {
    return "per_trade_cap";
  }
  return c.spentUsdMicros + value > c.rollingDayUsdMicros ? "daily_cap" : undefined;
}

// How the case ends: at its card unless a cap refuses it, and only a stake the caps let through
// stores the value the rolling cap counts once it is confirmed.
function expectedOf(c: Case) {
  const refusal = capRefusalOf(c);
  return refusal === undefined
    ? { state: "awaiting_confirmation", reason: undefined, isValued: c.action === "stake" }
    : { state: "rejected_policy", reason: refusal, isValued: false };
}

async function outcomeOf(c: Case) {
  const { perTradeUsdMicros, rollingDayUsdMicros } = c;
  const limits = { ...testLimits, perTradeUsdMicros, rollingDayUsdMicros };
  const test = await startStakeEngine(await stakedFake(), {
    agent: { mode: "live", limits: { ...limits, venues: [...limits.venues, testStakingVenue] } },
    facts: { recentOutflows: [{ atMs: testNowMs - 1_000, valueUsdMicros: c.spentUsdMicros }] },
    prices: new Map([[testCoin, coinPrice]]),
    chainSimulator: stakingSimulator({ simulate: async () => Promise.resolve([]) }),
  });
  const request =
    c.action === "stake"
      ? stakeRequest("stake", { amount: { asset: testCoin, base: c.amountBase } })
      : stakeRequest(c.action);
  const proposed = await test.engine.handlers["intent/propose"](testCall(request));
  if (!proposed.ok) {
    throw new Error(`The ${c.action} was refused: ${proposed.error}.`);
  }
  const { record } = await testSnapshot(test, proposed.value.intent);
  return {
    state: record.state,
    reason: record.reason,
    isValued: record.valueUsdMicros !== undefined,
  };
}

describe("staking and the caps", () => {
  it("lets no stake past either cap, and counts no unstake or claim against them", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (c) => {
        expect(await outcomeOf(c)).toStrictEqual(expectedOf(c));
      }),
      { numRuns: 100 },
    );
  });
});
