import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { Amount } from "../amount.js";
import type { AccountRef } from "../caip/account-ref.js";
import { accountRefParts } from "../caip/account-ref.js";
import { assetRefParts } from "../caip/asset-ref.js";
import type { StakeRequest } from "../staking/staking-terms.js";
import {
  landedPlan,
  live,
  onlyHolding,
  planned,
  type StakingVenueHarness,
  type StakingVenueSubject,
  staked,
} from "./staking-venue-checks.js";

const msPerSecond = 1_000;

async function listsValidators(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  const { pool } = subject.venue;
  const options = await subject.venue.options(live());
  const of = (account: AccountRef) => options.validators.find((item) => item.validator === account);
  assert.equal(of(subject.active)?.jailed, false);
  assert.equal(subject.jailed === undefined ? true : of(subject.jailed)?.jailed, true);
  assert.equal(of(subject.unknown), undefined);
  // A liquid venue lists its pool alone, and every move names it.
  assert.ok(pool === undefined || (options.validators.length === 1 && subject.active === pool));
  assert.ok(pool === undefined || subject.jailed === undefined);
  assert.ok(options.unbondingSeconds > 0);
  assert.equal(options.minStake.asset, subject.stake.asset);
  assert.ok(options.minStake.base <= subject.stake.base);
  assert.equal(assetRefParts(options.minStake.asset).chain, subject.venue.chain);
}

async function stakesAndReadsBack(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  assert.deepEqual(await subject.venue.holdings(subject.wallet, live()), []);
  const { plan, landed } = await staked(subject);
  const options = await subject.venue.options(live());
  const listed = options.validators.find((item) => item.validator === subject.active);
  assert.deepEqual([plan.value, plan.moved], [subject.stake, subject.stake]);
  assert.deepEqual(
    [plan.commissionBps, plan.jailed, plan.paper],
    [listed?.commissionBps, false, false],
  );
  assert.ok(plan.pool !== undefined && (plan.shares?.base ?? 0n) > 0n);
  const held = await onlyHolding(subject);
  const receipt = await subject.venue.receipt(subject.active, live());
  const none = await subject.venue.receipt(subject.unknown, live());
  assert.deepEqual(receipt, { ok: true, value: held.staked.asset });
  assert.deepEqual(none, { ok: false, error: "validator_unknown" });
  assert.deepEqual([landed.moved, landed.shares], [subject.stake, held.staked]);
  assert.deepEqual(landed.shares, plan.shares);
  assert.ok((landed.shares?.base ?? 0n) >= (plan.minShares?.base ?? 0n));
  assert.ok(held.stakedValue.base > 0n && held.stakedValue.base <= subject.stake.base);
  assert.deepEqual([held.unbonding, held.claimable.base], [[], 0n]);
}

async function unstakesAndClaims(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  const { wallet, active: validator } = subject;
  await staked(subject);
  const held = await onlyHolding(subject);
  const plan = await planned(subject, { action: "unstake", wallet, validator, amount: "whole" });
  assert.deepEqual([plan.shares, plan.moved, plan.value.base], [held.staked, held.stakedValue, 0n]);
  assert.equal(plan.readyAtMs, plan.plannedAtMs + plan.unbondingSeconds * msPerSecond);
  const landed = await landedPlan(subject, plan);
  const [part, ...rest] = (await onlyHolding(subject)).unbonding;
  assert.ok(part !== undefined && rest.length === 0);
  assert.deepEqual([landed.request, landed.shares], [part, plan.shares]);
  assert.ok(part.readyAtMs >= (plan.readyAtMs ?? 0));
  assert.equal(part.queued === true, subject.venue.pool !== undefined);
  const early = await subject.venue.plan({ action: "claim", wallet, validator }, live());
  assert.deepEqual(early, {
    ok: false,
    error: "nothing_to_claim",
    facts: { readyAtMs: part.readyAtMs },
  });
  await subject.wait((part.readyAtMs - plan.plannedAtMs) / msPerSecond + 1);
  const claim = await planned(subject, { action: "claim", wallet, validator });
  assert.deepEqual([claim.parts, claim.moved, claim.value.base], [[part.ref], part.amount, 0n]);
  const claimed = await landedPlan(subject, claim);
  assert.deepEqual([claimed.claimed, claimed.moved], [[part.ref], part.amount]);
  assert.deepEqual(await subject.venue.holdings(wallet, live()), []);
}

// What an unstake names: the coin on a venue of validators, the receipt token on a liquid one.
async function unstakeAmount(subject: StakingVenueSubject, base: bigint): Promise<Amount> {
  const receipt = await subject.venue.receipt(subject.active, live());
  assert.ok(receipt.ok);
  return { asset: subject.venue.pool === undefined ? subject.stake.asset : receipt.value, base };
}

async function refusesInOrder(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  const { wallet, stake, active, jailed } = subject;
  const options = await subject.venue.options(live());
  const small = { ...stake, base: options.minStake.base - 1n };
  const unstaked = await unstakeAmount(subject, stake.base);
  const jailedAsks: readonly StakeRequest[] =
    jailed === undefined
      ? []
      : [
          { action: "stake", wallet, validator: jailed, amount: stake },
          { action: "stake", wallet, validator: jailed, amount: small },
        ];
  const asks: readonly StakeRequest[] = [
    { action: "stake", wallet, validator: subject.unknown, amount: stake },
    { action: "unstake", wallet, validator: active, amount: unstaked },
    { action: "claim", wallet, validator: active },
    { action: "stake", wallet, validator: active, amount: small },
    ...jailedAsks,
  ];
  const answers = await Promise.all(asks.map(async (ask) => subject.venue.plan(ask, live())));
  const jailedErrors = jailed === undefined ? [] : ["validator_jailed", "below_min_stake"];
  assert.deepEqual(
    answers.map((answer) => (answer.ok ? "planned" : answer.error)),
    ["validator_unknown", "nothing_staked", "nothing_to_claim", "below_min_stake", ...jailedErrors],
  );
  // The least stake goes with its refusal; a claim with no part waiting names no ready time.
  const facts = answers.map((answer) => (answer.ok ? undefined : answer.facts));
  assert.deepEqual([facts[2], facts[3]], [undefined, { minStake: options.minStake }]);
}

async function refusesOverUnstake(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  const { wallet, active: validator } = subject;
  const { plan } = await staked(subject);
  const held = subject.venue.pool === undefined ? plan.moved.base : (plan.shares?.base ?? 0n);
  const amount = await unstakeAmount(subject, held * 2n);
  const answer = await subject.venue.plan({ action: "unstake", wallet, validator, amount }, live());
  assert.deepEqual(answer, { ok: false, error: "exceeds_staked" });
}

async function unstakesPart(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  const { venue, wallet, active: validator } = subject;
  await staked(subject);
  const held = await onlyHolding(subject);
  const isLiquid = venue.pool !== undefined;
  const half = await unstakeAmount(
    subject,
    (isLiquid ? held.staked.base : held.stakedValue.base) / 2n,
  );
  const plan = await planned(subject, { action: "unstake", wallet, validator, amount: half });
  // A liquid venue burns exactly the units named; one of validators takes out at least the coin.
  const isExact = plan.shares?.base === half.base && plan.shares.asset === half.asset;
  assert.ok(isLiquid ? isExact : plan.moved.base >= half.base);
  const landed = await landedPlan(subject, plan);
  assert.deepEqual(landed.shares, plan.shares);
}

async function plansPaper(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  const { wallet, active: validator, stake } = subject;
  await staked(subject);
  const { readAtMs } = await subject.venue.options(live());
  const shares = (await onlyHolding(subject)).staked.base * 3n;
  const ready = { ref: "paper-1", amount: stake, readyAtMs: readAtMs };
  const later = { ref: "paper-2", amount: stake, readyAtMs: readAtMs + 3_600 * msPerSecond };
  const paper = { shares, parts: [ready, later] };
  const unstake = await planned(subject, {
    action: "unstake",
    wallet,
    validator,
    amount: "whole",
    paper,
  });
  const claim = await planned(subject, { action: "claim", wallet, validator, paper });
  const empty = { shares: 0n, parts: [later] };
  const none = await subject.venue.plan(
    { action: "claim", wallet, validator, paper: empty },
    live(),
  );
  assert.deepEqual([unstake.paper, unstake.shares?.base], [true, shares]);
  assert.ok(unstake.pool !== undefined && unstake.moved.base > stake.base);
  assert.deepEqual([claim.paper, claim.parts, claim.moved], [true, ["paper-1"], stake]);
  assert.deepEqual(none, {
    ok: false,
    error: "nothing_to_claim",
    facts: { readyAtMs: later.readyAtMs },
  });
}

async function readsPools(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  const { venue, active, stake } = subject;
  const { landed } = await staked(subject);
  const minted = landed.shares;
  assert.ok(minted !== undefined);
  const [found, ...rest] = await venue.pools([stake.asset, minted.asset], live());
  assert.ok(found !== undefined && rest.length === 0, "The venue should read one pool.");
  assert.deepEqual([found.validator, found.pool.shares.asset], [active, minted.asset]);
  assert.equal(found.pool.coin.asset, stake.asset);
  assert.ok(found.pool.shares.base >= minted.base && found.pool.coin.base > 0n);
}

async function readsBackOnlyItsMove(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  const { wallet, active: validator, stake } = subject;
  const plan = await planned(subject, { action: "stake", wallet, validator, amount: stake });
  const [hash] = await subject.run(await subject.venue.build(plan, live()));
  assert.ok(hash !== undefined);
  const asUnstake = await subject.venue.landed(
    { action: "unstake", wallet, validator, hash },
    live(),
  );
  const elsewhere = await subject.venue.landed(
    { action: "stake", wallet, validator: subject.jailed ?? subject.unknown, hash },
    live(),
  );
  assert.deepEqual(
    [asUnstake, elsewhere],
    [
      { ok: false, error: "not_found" },
      { ok: false, error: "not_found" },
    ],
  );
}

async function refusesForeign(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  assert.ok(subject.foreign.length > 0);
  for (const draft of subject.foreign) {
    assert.equal(accountRefParts(draft.from).address, accountRefParts(subject.wallet).address);
    assert.deepEqual(subject.venue.decode(draft), { ok: false, error: "unknown_call" });
  }
}

async function stopsOnAbort(harness: StakingVenueHarness): Promise<void> {
  const subject = await harness.create();
  const { venue, wallet, active: validator, stake } = subject;
  const plan = await planned(subject, { action: "stake", wallet, validator, amount: stake });
  const reason = new Error("stopped");
  const signal = AbortSignal.abort(reason);
  const [hash] = await subject.run(await venue.build(plan, live()));
  assert.ok(hash !== undefined);
  await assert.rejects(venue.options({ signal }), reason);
  await assert.rejects(venue.holdings(wallet, { signal }), reason);
  await assert.rejects(venue.receipt(validator, { signal }), reason);
  await assert.rejects(venue.pools([stake.asset], { signal }), reason);
  await assert.rejects(venue.plan({ action: "claim", wallet, validator }, { signal }), reason);
  await assert.rejects(venue.build(plan, { signal }), reason);
  await assert.rejects(
    venue.landed({ action: "stake", wallet, validator, hash }, { signal }),
    reason,
  );
}

/** The contract every `StakingVenue` passes. */
export function stakingVenueContract(harness: StakingVenueHarness): readonly ContractCheck[] {
  return [
    {
      name: "lists the validators with which are jailed, its unbonding time and least stake",
      run: async () => listsValidators(harness),
    },
    {
      name: "stakes in one call that credits the wallet, and reads back the receipt shares it minted",
      run: async () => stakesAndReadsBack(harness),
    },
    {
      name: "unstakes the whole stake, reads back its request, then claims it once it is ready",
      run: async () => unstakesAndClaims(harness),
    },
    {
      name: "refuses an unknown validator, an empty unstake or claim, a small stake, then a jailed one, and names the least stake",
      run: async () => refusesInOrder(harness),
    },
    {
      name: "refuses to unstake more than the stake is worth",
      run: async () => refusesOverUnstake(harness),
    },
    {
      name: "unstakes part of a stake, a liquid venue its receipt units exactly after approving them",
      run: async () => unstakesPart(harness),
    },
    {
      name: "plans a paper unstake and claim from the paper position alone",
      run: async () => plansPaper(harness),
    },
    {
      name: "reads the pool of a receipt token it minted, and leaves out a token it does not mint",
      run: async () => readsPools(harness),
    },
    {
      name: "reads back only the move its transaction holds",
      run: async () => readsBackOnlyItsMove(harness),
    },
    {
      name: "decodes no call it never builds, so nothing it reads credits another account",
      run: async () => refusesForeign(harness),
    },
    {
      name: "refuses to read or build on an aborted signal",
      run: async () => stopsOnAbort(harness),
    },
  ];
}
