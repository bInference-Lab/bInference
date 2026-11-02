import type { ChainRegistry, RegisteredChain } from "@binference/chain";
import type { LandedStake, StakePlan, StakeRequest, StakingVenue } from "@binference/chain/staking";
import { ok } from "@binference/core";
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
// The watch reads a holding again after five minutes.
const rereadMs = 5 * 60_000 + 1;

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

// The keys of the notices the engine and its executor sent, oldest first.
function noticeKeysOf(bench: ExecutorBench): readonly string[] {
  return [...bench.test.pushes, ...bench.pushes]
    .filter(({ kind }) => kind === "notice/new")
    .map(({ data }) => /"key":"([^"]+)"/u.exec(JSON.stringify(data))?.[1] ?? "");
}

// What a stake read back, minting one percent fewer units than it did.
function lessByOnePercent(landed: LandedStake): LandedStake {
  const { shares } = landed;
  return shares === undefined
    ? landed
    : { ...landed, shares: { ...shares, base: shares.base - shares.base / 100n } };
}

// The venue, reading back each landed move one percent short of its units, and the last read-back
// it gave.
function mintingLess<T extends StakingVenue>(fake: T) {
  const seen: { landed: LandedStake | undefined } = { landed: undefined };
  const landed: StakingVenue["landed"] = async (move, call) => {
    const read = await fake.landed(move, call);
    seen.landed = read.ok ? lessByOnePercent(read.value) : undefined;
    return seen.landed === undefined ? read : ok(seen.landed);
  };
  return { venue: { ...fake, landed }, seen };
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
    await bench.test.clock.advance(rereadMs);
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

  it("closes an unstake its venue's bot claimed for the wallet, books its coin once and tells the owner once", async () => {
    const fake = testLiquidFake();
    const bench = await stakeBench(landing(fake), { chains: liquidChains() });
    const stake = await tapped(bench, liquidRequest("stake"));
    await bench.release();
    await driveUntil(bench, stake, { states: stakeEnds });
    const units = { asset: testPoolReceipt, base: 10n ** 17n };
    const unstake = await tapped(bench, liquidRequest("unstake", { amount: units }));
    await bench.release();
    await driveUntil(bench, unstake, { states: stakeEnds });
    fake.wait(testUnbondingSeconds + 1);
    await bench.test.clock.advance(testUnbondingSeconds * 1_000 + dayMs);
    fake.claimFor(testAccount, "1");

    const closed = await bench.test.engine.tellClaimsReady(live);
    await bench.test.clock.advance(rereadMs);
    const again = await bench.test.engine.tellClaimsReady(live);

    expect([closed, again]).toStrictEqual([1, 0]);
    await expect(openRows(bench)).resolves.toStrictEqual([]);
    const arrivals = await bench.test.positions.arrivals(mine, live);
    expect(arrivals.map(({ received }) => received.base)).toStrictEqual([11n * 10n ** 16n]);
    expect(arrivals[0]?.valueUsdMicros).toBeDefined();
    expect(noticeKeysOf(bench).filter((key) => key === "notice.claimedElsewhere")).toHaveLength(1);
  });

  it("leaves open an unstake a confirmed claim names, and ends that claim at the queue once its request is gone", async () => {
    const fake = testLiquidFake();
    const bench = await stakeBench(landing(fake), { chains: liquidChains() });
    const stake = await tapped(bench, liquidRequest("stake"));
    await bench.release();
    await driveUntil(bench, stake, { states: stakeEnds });
    const tenth = { asset: testPoolReceipt, base: 10n ** 17n };
    for (const amount of [tenth, tenth]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the second unstake follows the first
      const unstake = await tapped(bench, liquidRequest("unstake", { amount }));
      // oxlint-disable-next-line eslint/no-await-in-loop -- each lands before the next
      await bench.release();
      // oxlint-disable-next-line eslint/no-await-in-loop -- each lands before the next
      await driveUntil(bench, unstake, { states: stakeEnds });
    }
    fake.wait(testUnbondingSeconds + 1);
    await bench.test.clock.advance(testUnbondingSeconds * 1_000 + dayMs);
    const claim = await tapped(bench, liquidRequest("claim"));
    // Its request goes outside binference, while the second stays released: a new plan passes.
    fake.claimFor(testAccount, "1");

    // The second is told ready; the first, which the claim names, stays open.
    const told = await bench.test.engine.tellClaimsReady(live);
    await expect(openRows(bench)).resolves.toHaveLength(2);
    await bench.release();
    const ended = await driveUntil(bench, claim, { states: stakeEnds });

    expect(told).toBe(1);
    expect([ended, await stakeReasonOf(bench, claim)]).toStrictEqual([
      "failed_check",
      "nothing_to_claim",
    ]);
    expect(bench.signed).toHaveLength(5);
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

  it("books a stake that minted fewer units than its card promised as it landed, and tells the owner", async () => {
    const { venue, seen } = mintingLess(landing(testLiquidFake()));
    const bench = await stakeBench(venue, { chains: liquidChains() });
    const intent = await tapped(bench, liquidRequest("stake"));
    await bench.release();

    await expect(driveUntil(bench, intent, { states: stakeEnds })).resolves.toBe("reconciled");
    const [booked] = await boughtOf(bench);
    expect(booked?.bought).toStrictEqual(seen.landed?.shares);
    expect(noticeKeysOf(bench)).toContain("notice.stakeMintedFewer");
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
