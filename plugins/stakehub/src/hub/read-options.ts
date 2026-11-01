import {
  type AssetRef,
  accountRefSchema,
  bpsSchema,
  type ChainRef,
  type StakingOptions,
  type StakingValidator,
} from "@binference/plugin-sdk";
import type { Address } from "viem";
import {
  commissionRead,
  hubNumberRead,
  jailRead,
  monikerRead,
  rewardDayRead,
  validatorsRead,
} from "./hub-calls.js";
import { type BlockRead, readEach, required, unreadable } from "./hub-read.js";

/** Where the options are read: the block, StakeHub, and the chain whose coin it stakes. */
export interface OptionsRead extends BlockRead {
  readonly hub: Address;
  readonly chain: ChainRef;
  readonly coin: AssetRef;
}

const msPerSecond = 1_000n;
const daysPerYear = 365n;
const bpsPerWhole = 10_000n;

/** StakeHub's numbers every move needs: the unbonding time, the least stake, a reward day. */
export interface HubNumbers {
  readonly unbondSeconds: bigint;
  readonly minStake: bigint;
  readonly daySeconds: bigint;
}

/** Reads StakeHub's unbonding time, least stake and reward day length at the read's block. */
export async function readHubNumbers(at: BlockRead, hub: Address): Promise<HubNumbers> {
  const names = ["unbondPeriod", "minDelegationBNBChange", "BREATHE_BLOCK_INTERVAL"] as const;
  const [unbond, least, day] = await readEach(
    at,
    names.map((name) => hubNumberRead(hub, name)),
  );
  return {
    unbondSeconds: required(unbond, "unbondPeriod"),
    minStake: required(least, "minDelegationBNBChange"),
    daySeconds: required(day, "BREATHE_BLOCK_INTERVAL"),
  };
}

// The rate a day's rewards paid on the pool before them, a year at that rate, in basis points;
// the newest of the two days whose pool StakeHub recorded, since a day's record lands with its
// first block. Undefined when neither holds one.
function aprOf(days: readonly (bigint | undefined)[]): number | undefined {
  const [reward, pooled, earlierReward, earlierPooled] = days;
  const pick =
    pooled !== undefined && pooled > 0n
      ? { reward, pooled }
      : { reward: earlierReward, pooled: earlierPooled };
  if (pick.reward === undefined || pick.pooled === undefined || pick.pooled === 0n) {
    return undefined;
  }
  return Number((pick.reward * daysPerYear * bpsPerWhole) / pick.pooled);
}

// A validator's seven reads: moniker, commission, jail state, and two days of rewards and pool.
async function readValidators(
  at: OptionsRead,
  operators: readonly Address[],
  daySeconds: bigint,
): Promise<readonly StakingValidator[]> {
  const today = at.time / daySeconds;
  const days = [today, today - 1n].flatMap((index) =>
    (["reward", "pooled"] as const).map((part) => ({ index, part })),
  );
  const { hub } = at;
  const [names, rates, jails, records] = await Promise.all([
    readEach(
      at,
      operators.map((operator) => monikerRead(hub, operator)),
    ),
    readEach(
      at,
      operators.map((operator) => commissionRead(hub, operator)),
    ),
    readEach(
      at,
      operators.map((operator) => jailRead(hub, operator)),
    ),
    readEach(
      at,
      operators.flatMap((operator) => days.map((day) => rewardDayRead(hub, operator, day))),
    ),
  ]);
  return operators.map((operator, index) => {
    const commission = bpsSchema.safeParse(Number(required(rates[index], "a commission")));
    const jail = required(jails[index], "a validator's jail state");
    if (!commission.success) {
      throw unreadable("a validator's commission is above 100%.");
    }
    const aprBps = aprOf(records.slice(index * days.length, (index + 1) * days.length));
    return {
      validator: accountRefSchema.parse(`${at.chain}:${operator}`),
      name: required(names[index], "a validator's description"),
      commissionBps: commission.data,
      ...(aprBps === undefined ? {} : { aprBps }),
      jailed: jail.jailed,
      ...(jail.jailed ? { jailedUntilMs: Number(jail.jailUntil * msPerSecond) } : {}),
    };
  });
}

/**
 * Reads every validator StakeHub lists at the read's block, with its moniker, commission, jail
 * state and the yearly rate of its last recorded day of rewards, and StakeHub's unbonding time and
 * least stake. A revert of a call StakeHub always answers, or an answer outside its shape, is
 * `stakehub.read_failed`.
 */
export async function readOptions(at: OptionsRead): Promise<StakingOptions> {
  const [list, numbers] = await Promise.all([
    readEach(at, [validatorsRead(at.hub)]),
    readHubNumbers(at, at.hub),
  ]);
  const { operators } = required(list[0], "getValidators");
  const validators = await readValidators(at, operators, numbers.daySeconds);
  return {
    validators,
    unbondingSeconds: Number(numbers.unbondSeconds),
    minStake: { asset: at.coin, base: numbers.minStake },
    readAtMs: Number(at.time * msPerSecond),
  };
}
