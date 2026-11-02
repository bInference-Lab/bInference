import type { ChainRegistry, RegisteredChain } from "@binference/chain";
import type { StakePlan, StakeRequest, StakingVenue } from "@binference/chain/staking";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testWallet } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import {
  liquidChains,
  liquidRequest,
  testLiquidFake,
  testPoolReceipt,
} from "../staking/test-liquid-stakes.js";
import { halfCoin, testUnbondingSeconds } from "../staking/test-stakes.js";
import { createStakingHost } from "../venues/staking-host.js";
import { stakeTargetsOf } from "./stake-queue-check.js";
import { driveUntil, type ExecutorBench, tapped } from "./test-executor.js";
import { landing, refusable, stakeBench, stakeEnds, stakeReasonOf } from "./test-stake-bench.js";

const live = { signal: new AbortController().signal };
const mine = { isPaper: false, walletId: testWallet, after: 0, limit: 10 };
const dayMs = 86_400_000;
const pool = testLiquidFake().pool;

// The plan without its promise of least units, minting one unit fewer than it promised.
function fewer({ minShares, ...plan }: StakePlan): StakePlan {
  return minShares === undefined
    ? plan
    : { ...plan, shares: { ...minShares, base: minShares.base - 1n } };
}

async function plannedOn(venue: StakingVenue, request: StakeRequest): Promise<StakePlan> {
  const planned = await venue.plan(request, live);
  if (!planned.ok) {
    throw new Error(`The fake pool refused the ${request.action}: ${planned.error}.`);
  }
  return planned.value;
}

function chainOf(chains: ChainRegistry): RegisteredChain {
  const found = chains.get(testLiquidFake().chain);
  if (!found.ok) {
    throw new Error("The fake pool's chain should be registered.");
  }
  return found.value;
}

async function boughtOf(bench: ExecutorBench) {
  const executions = await bench.test.positions.executions(mine, live);
  return executions.map(({ sold, bought }) => ({ sold, bought }));
}

// The wallet's open unbondings on the pool, as the store holds them.
async function openRows(bench: ExecutorBench) {
  const query = { walletId: testWallet, isPaper: false, venue: "fake-liquid", validator: pool };
  return bench.test.stores.unbondings.listOpen(query, live);
}

describe("a live move on a liquid pool (decision 0331)", () => {
  it("stakes, unstakes receipt units after their exact approval, and claims once the queue releases them", async () => {
    const fake = testLiquidFake();
    const bench = await stakeBench(landing(fake), { chains: liquidChains() });

    const stake = await tapped(bench, liquidRequest("stake"));
    await bench.release();
    await expect(driveUntil(bench, stake, { states: stakeEnds })).resolves.toBe("reconciled");
    const units = { asset: testPoolReceipt, base: 10n ** 17n };
    const unstake = await tapped(bench, liquidRequest("unstake", { amount: units }));
    await bench.release();
    await expect(driveUntil(bench, unstake, { states: stakeEnds })).resolves.toBe("reconciled");
    const steps = await bench.test.stores.transactions.ofIntent(unstake, live);
    const rows = await openRows(bench);
    fake.holdQueue();
    fake.wait(testUnbondingSeconds + 1);
    await bench.test.clock.advance(testUnbondingSeconds * 1_000 + dayMs);
    const whileHeld = await bench.test.engine.tellClaimsReady(live);
    fake.releaseQueue();
    const released = await bench.test.engine.tellClaimsReady(live);
    const claim = await tapped(bench, liquidRequest("claim"));
    await bench.release();
    await expect(driveUntil(bench, claim, { states: stakeEnds })).resolves.toBe("reconciled");

    const [bought] = await boughtOf(bench);
    expect(bought?.sold).toStrictEqual(halfCoin);
    expect(bought?.bought.asset).toBe(testPoolReceipt);
    expect(steps).toHaveLength(2);
    expect(rows.map(({ amount, requestRef }) => [amount.base, requestRef])).toStrictEqual([
      [11n * 10n ** 16n, "1"],
    ]);
    expect([whileHeld, released]).toStrictEqual([0, 1]);
    await expect(openRows(bench)).resolves.toStrictEqual([]);
  });

  it("ends decode_mismatch, signing nothing, when the stake would now mint fewer units than its card promised", async () => {
    const { answer, venue } = refusable(landing(testLiquidFake()));
    const bench = await stakeBench(venue, { chains: liquidChains() });
    const intent = await tapped(bench, liquidRequest("stake"));
    // A plan that promises nothing itself, so only the card's promise holds it.
    answer.mangle = fewer;
    await bench.release();
    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("failed_check");
    await expect(stakeReasonOf(bench, intent)).resolves.toBe("decode_mismatch");
    expect(bench.signed).toHaveLength(0);
  });

  it("lets the signer reach the pool's declared spender only for a liquid unstake", async () => {
    const venue = testLiquidFake();
    const chains = liquidChains();
    const staking = createStakingHost({ venues: [venue], chains, clock: createManualClock(0) });
    const asked = { wallet: testAccount, validator: venue.pool };
    const stake = await plannedOn(venue, { ...asked, action: "stake", amount: halfCoin });
    venue.run(await venue.build(stake, live));
    const unstake = await plannedOn(venue, { ...asked, action: "unstake", amount: "whole" });
    const context = { chain: chainOf(chains), venues: [], staking };
    const targetsOf = (plan: StakePlan) =>
      stakeTargetsOf({ venue: venue.id, plan, liquid: true }, context).spenders;

    expect(targetsOf(unstake)).toStrictEqual([venue.pool]);
    expect(targetsOf(stake)).toStrictEqual([]);
  });
});
