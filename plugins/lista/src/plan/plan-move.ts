import {
  type AccountRef,
  type Amount,
  err,
  ok,
  type StakePlan,
  type StakePlanned,
  type StakeRequest,
  type UnbondingPart,
} from "@binference/plugin-sdk";
import type { Address } from "viem";
import type { ListaAt } from "../manager/manager-read.js";
import { readParts } from "../manager/read-parts.js";
import { type PoolRead, readPool } from "../manager/read-pool.js";
import { coinFor, leastStake, leastUnits, unitsFor } from "./pool-math.js";

/** Lista on its chain as a plan names it: its pool, the stake manager, and the name it goes by. */
export interface ListaPlanAt extends ListaAt {
  readonly pool: AccountRef;
  readonly name: string;
}

/** What one plan asks: the request, and its wallet as an EVM address. */
export interface ListaAsk {
  readonly request: StakeRequest;
  readonly wallet: Address;
}

type PlanBase = Omit<StakePlan, "action" | "value" | "moved">;

const msPerSecond = 1_000;

function baseOf(at: ListaPlanAt, ask: ListaAsk, read: PoolRead): PlanBase {
  const { request } = ask;
  const { state } = read;
  return {
    wallet: request.wallet,
    validator: at.pool,
    validatorName: at.name,
    commissionBps: state.commissionBps,
    jailed: false,
    paper: request.paper !== undefined,
    pool: { shares: { asset: at.receipt, base: state.supply }, coin: coin(at, state.pooled) },
    unbondingSeconds: state.unbondingSeconds,
    plannedAtMs: state.timeMs,
  };
}

const coin = (at: ListaAt, base: bigint): Amount => ({ asset: at.coin, base });
const units = (at: ListaAt, base: bigint): Amount => ({ asset: at.receipt, base });

/** A plan's parts: where it reads, its common fields and the pool read at its block. */
interface Planning {
  readonly at: ListaPlanAt;
  readonly base: PlanBase;
  readonly read: PoolRead;
}

function stakePlan({ at, base, read }: Planning, amount: Amount): StakePlanned {
  const minted = unitsFor(amount.base, read.state);
  if (minted === 0n) {
    return { ...err("below_min_stake"), facts: { minStake: coin(at, leastStake(read.state)) } };
  }
  return ok({
    ...base,
    action: "stake",
    value: amount,
    moved: amount,
    shares: units(at, minted),
    minShares: units(at, leastUnits(minted)),
  });
}

function unstakePlan(
  { at, base, read }: Planning,
  request: Extract<StakeRequest, { readonly action: "unstake" }>,
): StakePlanned {
  const held = request.paper?.shares ?? read.balance ?? 0n;
  if (held === 0n) {
    return err("nothing_staked");
  }
  const wanted = request.amount === "whole" ? held : request.amount.base;
  if (wanted > held) {
    return err("exceeds_staked");
  }
  const moved = coinFor(wanted, read.state);
  if (moved < read.state.minBnb) {
    return { ...err("below_min_stake"), facts: { minStake: coin(at, read.state.minBnb) } };
  }
  const readyAtMs = read.state.timeMs + read.state.unbondingSeconds * msPerSecond;
  const plan = { ...base, value: coin(at, 0n), moved: coin(at, moved), shares: units(at, wanted) };
  return ok({ ...plan, action: "unstake", readyAtMs });
}

// A claim of the oldest part ready now and released by Lista's queue; with none, when the next
// part is ready, if one waits.
function claimPlan(base: PlanBase, parts: readonly UnbondingPart[], nowMs: number): StakePlanned {
  const ready = parts.find((part) => part.queued !== true && part.readyAtMs <= nowMs);
  if (ready === undefined) {
    const [next] = parts.toSorted((first, second) => first.readyAtMs - second.readyAtMs);
    return {
      ...err("nothing_to_claim"),
      ...(next === undefined ? {} : { facts: { readyAtMs: next.readyAtMs } }),
    };
  }
  const { pool: _pool, ...rest } = base;
  const zero = { ...ready.amount, base: 0n };
  return ok({ ...rest, action: "claim", value: zero, moved: ready.amount, parts: [ready.ref] });
}

/**
 * Plans a move at the latest block, or names why Lista would refuse it, in the order its stake
 * manager checks: `validator_unknown` for any pool but Lista's, `staking_paused` while paused, then
 * `below_min_stake` for a stake that mints no slisBNB, with the least that mints a unit;
 * `nothing_staked`, `exceeds_staked`, then `below_min_stake` with Lista's least withdrawal for an
 * unstake; `nothing_to_claim` for a claim with no part released, with the next part's time. A
 * stake promises 10 basis points under what it mints now; a paper plan reads only Lista's pool,
 * never the wallet.
 */
export async function planMove(at: ListaPlanAt, ask: ListaAsk): Promise<StakePlanned> {
  const { request } = ask;
  if (request.validator !== at.pool) {
    return err("validator_unknown");
  }
  const isWalletRead = request.paper === undefined && request.action !== "stake";
  const read = await readPool(at, isWalletRead ? { wallet: ask.wallet } : {});
  if (read.state.paused) {
    return err("staking_paused");
  }
  const base = baseOf(at, ask, read);
  if (request.action === "stake") {
    return stakePlan({ at, base, read }, request.amount);
  }
  if (request.action === "unstake") {
    return unstakePlan({ at, base, read }, request);
  }
  const parts =
    request.paper?.parts ?? (await readParts(at, { ...read, wallet: ask.wallet })).parts;
  return claimPlan(base, parts, read.state.timeMs);
}
