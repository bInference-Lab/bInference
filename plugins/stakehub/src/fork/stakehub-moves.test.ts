import { withFork } from "@binference/chain-evm/fork";
import type {
  AccountRef,
  LandedStake,
  StakePlan,
  StakeRequest,
  StakingHolding,
  UnbondingPart,
} from "@binference/plugin-sdk";
import { successOf } from "@binference/plugin-sdk/testing";
import type { TransactionReceipt } from "viem";
import { describe, expect, it } from "vitest";
import {
  addressOf,
  freshWallet,
  hashesOf,
  type Placed,
  placeStakeHub,
  runDrafts,
} from "./stake-hub-placement.js";

// One wallet's moves through StakeHub on the pinned BSC fork, in one fork session (see
// stakehub-staking.test.ts): a stake, a whole unstake and its claim a week later, and a stake to
// a validator a downtime slash jailed, which the venue refuses and StakeHub reverts.
const bnb = 10n ** 18n;

async function planned(
  placed: Placed,
  request: StakeRequest,
  signal: AbortSignal,
): Promise<StakePlan> {
  return successOf(await placed.venue.plan(request, { signal }));
}

function gasOf(receipts: readonly TransactionReceipt[]): bigint {
  return receipts.reduce((sum, receipt) => sum + receipt.gasUsed * receipt.effectiveGasPrice, 0n);
}

function onlyOf<T>(items: readonly T[]): T {
  const [item, ...rest] = items;
  if (item === undefined || rest.length > 0) {
    throw new Error(`Expected one item, got ${String(items.length)}.`);
  }
  return item;
}

// What the venue read back of the three moves, and the unstake's request.
interface LandedTrip {
  readonly stake: LandedStake;
  readonly unstake: LandedStake;
  readonly claim: LandedStake;
  readonly request: UnbondingPart;
}

interface RoundTrip {
  readonly stake: StakePlan;
  readonly unstake: StakePlan;
  readonly claim: StakePlan;
  readonly held: StakingHolding;
  readonly receipts: readonly TransactionReceipt[];
  readonly landed: LandedTrip;
  readonly spent: bigint;
}

function tripOf(landed: readonly LandedStake[]): LandedTrip {
  const [stake, unstake, claim, ...rest] = landed;
  if (stake === undefined || unstake === undefined || claim === undefined || rest.length > 0) {
    throw new Error(`Expected three moves, got ${String(landed.length)}.`);
  }
  const { request } = unstake;
  if (request === undefined) {
    throw new Error("The unstake read back no request.");
  }
  return { stake, unstake, claim, request };
}

// What the venue reads back of each move's transaction.
async function landedOf(
  placed: Placed,
  moves: readonly { readonly plan: StakePlan; readonly receipt: TransactionReceipt }[],
  signal: AbortSignal,
): Promise<readonly LandedStake[]> {
  const read = moves.map(async ({ plan, receipt }) => {
    const [hash] = hashesOf([receipt]);
    const { action, wallet, validator } = plan;
    const move = { action, wallet, validator, hash: onlyOf([hash].flatMap((item) => item ?? [])) };
    return successOf(await placed.venue.landed(move, { signal }));
  });
  return Promise.all(read);
}

// Stakes 2 BNB, unstakes the whole stake, waits out the unbonding time and claims it back.
async function roundTrip(
  placed: Placed,
  wallet: AccountRef,
  signal: AbortSignal,
): Promise<RoundTrip> {
  const { fork, venue, active: validator } = placed;
  const amount = { asset: fork.chain.nativeAsset, base: 2n * bnb };
  const before = await fork.client.getBalance({ address: addressOf(wallet) });
  const stake = await planned(placed, { action: "stake", wallet, validator, amount }, signal);
  const staked = await runDrafts(fork, await venue.build(stake, { signal }));
  const held = onlyOf(await venue.holdings(wallet, { signal }));
  const ask = { action: "unstake", wallet, validator, amount: "whole" } as const;
  const unstake = await planned(placed, ask, signal);
  const unstaked = await runDrafts(fork, await venue.build(unstake, { signal }));
  await fork.call("evm_increaseTime", [unstake.unbondingSeconds + 1]);
  await fork.call("evm_mine", []);
  const claim = await planned(placed, { action: "claim", wallet, validator }, signal);
  const claimed = await runDrafts(fork, await venue.build(claim, { signal }));
  const after = await fork.client.getBalance({ address: addressOf(wallet) });
  const receipts = [...staked, ...unstaked, ...claimed];
  const plans = [stake, unstake, claim];
  const moves = receipts.map((receipt, index) => ({ plan: plans[index] ?? stake, receipt }));
  const landed = tripOf(await landedOf(placed, moves, signal));
  const spent = before - after - gasOf(receipts);
  return { stake, unstake, claim, held, receipts, landed, spent };
}

describe("one wallet's StakeHub moves on a fork of BSC", () => {
  it("stakes, unstakes, claims a week later, and is refused a jailed validator", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      const placed = await placeStakeHub(fork, signal);
      const wallet = await freshWallet(placed, "moves");
      const { venue, jailed: validator } = placed;
      const options = await venue.options({ signal });
      const listed = onlyOf(options.validators.filter((item) => item.validator === validator));
      expect(listed.jailed).toBe(true);
      expect(listed.jailedUntilMs).toBeGreaterThan(options.readAtMs);
      const amount = options.minStake;
      const refused = await venue.plan({ action: "stake", wallet, validator, amount }, { signal });
      expect(refused).toStrictEqual({ ok: false, error: "validator_jailed" });
      const stake = await planned(
        placed,
        { action: "stake", wallet, validator: placed.active, amount },
        signal,
      );
      const forced = await runDrafts(fork, await venue.build({ ...stake, validator }, { signal }));
      expect(forced.map((receipt) => receipt.status)).toStrictEqual(["reverted"]);

      const trip = await roundTrip(placed, wallet, signal);
      expect(trip.receipts.map((receipt) => receipt.status)).toStrictEqual([
        "success",
        "success",
        "success",
      ]);
      const { request } = trip.landed;
      expect(trip.stake.unbondingSeconds).toBe(604_800);
      expect([trip.landed.stake.shares, trip.landed.unstake.shares]).toStrictEqual([
        trip.stake.shares,
        trip.unstake.shares,
      ]);
      expect(trip.unstake.shares).toStrictEqual(trip.held.staked);
      expect(request.readyAtMs).toBeGreaterThanOrEqual(Number(trip.unstake.readyAtMs));
      expect([trip.claim.parts, trip.landed.claim.claimed]).toStrictEqual([
        [request.ref],
        [request.ref],
      ]);
      expect([trip.landed.claim.moved, request.amount]).toStrictEqual([
        trip.claim.moved,
        trip.claim.moved,
      ]);
      expect(trip.claim.moved).toStrictEqual(trip.unstake.moved);
      expect(2n * bnb - trip.unstake.moved.base).toBeLessThan(10n);
      expect(trip.spent).toBe(2n * bnb - trip.claim.moved.base);
      expect(await placed.venue.holdings(wallet, { signal })).toStrictEqual([]);
    });
  });
});
