import {
  type Amount,
  assetRefSchema,
  err,
  ok,
  type Result,
  type StakePlan,
  type StakePlanned,
  type StakeRefusal,
  type StakeRequest,
  type UnbondingPart,
} from "@binference/plugin-sdk";
import { maxClaimParts } from "../calls/decode-stake.js";
import { creditOfWalletRead } from "../hub/hub-calls.js";
import { holdsCode, readEach, required, unreadable } from "../hub/hub-read.js";
import { partOf, readQueues, readyRequests } from "../hub/read-holdings.js";
import type { OptionsRead } from "../hub/read-options.js";
import { coinOfShares, sharesOfCoin, unstakeShares } from "./credit-shares.js";
import { type Facts, type PlanAsk, readFacts } from "./plan-facts.js";

type PlanBase = Omit<StakePlan, "action" | "value" | "moved">;

/** What every move's plan starts from: the read, StakeHub's facts and the plan's common parts. */
interface PlanParts {
  readonly at: OptionsRead;
  readonly facts: Facts;
  readonly base: PlanBase;
}

const msPerSecond = 1_000n;

function coin(at: OptionsRead, base: bigint): Amount {
  return { asset: at.coin, base };
}

function receipt(parts: PlanParts, base: bigint): Amount {
  const asset = assetRefSchema.parse(`${parts.at.chain}/erc20:${parts.facts.credit}`);
  return { asset, base };
}

// StakeHub's voting token, which a stake mints and an unstake burns beside the credit shares.
function votingOf(at: OptionsRead): Pick<StakePlan, "votingToken"> {
  return at.votingToken === undefined ? {} : { votingToken: at.votingToken };
}

function poolOf(parts: PlanParts): NonNullable<StakePlan["pool"]> {
  const { supply, pooled } = parts.facts;
  return { shares: receipt(parts, supply), coin: coin(parts.at, pooled) };
}

// A stake, in StakeHub's order: under the least first, then a jailed validator.
function planStake(
  parts: PlanParts,
  request: Extract<StakeRequest, { readonly action: "stake" }>,
): StakePlanned {
  const { facts, base } = parts;
  const voting = votingOf(parts.at);
  if (request.amount.base < facts.numbers.minStake) {
    const minStake = coin(parts.at, facts.numbers.minStake);
    return { ...err("below_min_stake"), facts: { minStake } };
  }
  if (facts.jailed) {
    return err("validator_jailed");
  }
  if (facts.pooled === 0n) {
    throw unreadable("a validator's credit contract holds no pool.");
  }
  const minted = sharesOfCoin(request.amount.base, facts);
  const shares = receipt(parts, minted);
  const value = request.amount;
  return ok({
    ...base,
    action: "stake",
    value,
    moved: value,
    shares,
    pool: poolOf(parts),
    ...voting,
  });
}

// The shares the wallet holds with the validator: the paper position's, or read at the block.
async function heldShares(parts: PlanParts, ask: PlanAsk): Promise<bigint> {
  const paper = ask.request.paper;
  if (paper !== undefined) {
    return paper.shares;
  }
  const [held] = await readEach(parts.at, [
    creditOfWalletRead(parts.facts.credit, "balanceOf", ask.wallet),
  ]);
  return required(held, "a credit balance");
}

async function planUnstake(
  parts: PlanParts,
  ask: PlanAsk & { readonly amount: Amount | "whole" },
): Promise<Result<StakePlan, StakeRefusal>> {
  const { at, facts, base } = parts;
  const balance = await heldShares(parts, ask);
  if (balance === 0n) {
    return err("nothing_staked");
  }
  if (facts.supply === 0n || facts.pooled === 0n) {
    throw unreadable("a credit contract holds shares but no pool.");
  }
  const amount = ask.amount === "whole" ? "whole" : ask.amount.base;
  const burned = unstakeShares(amount, { balance, supply: facts.supply, pooled: facts.pooled });
  if (burned === "exceeds_staked") {
    return err(burned);
  }
  return ok({
    ...base,
    action: "unstake",
    value: coin(at, 0n),
    moved: coin(at, coinOfShares(burned.shares, facts)),
    shares: receipt(parts, burned.shares),
    pool: poolOf(parts),
    ...votingOf(at),
    readyAtMs: Number((at.time + facts.numbers.unbondSeconds) * msPerSecond),
  });
}

/** The parts a claim takes now, and when the first one still waiting is ready. */
interface ClaimParts {
  readonly ready: readonly UnbondingPart[];
  readonly nextReadyAtMs?: number;
}

function claimPartsOf(
  ready: readonly UnbondingPart[],
  next: UnbondingPart | undefined,
): ClaimParts {
  return {
    ready: ready.slice(0, Number(maxClaimParts)),
    ...(next === undefined ? {} : { nextReadyAtMs: next.readyAtMs }),
  };
}

// The parts a claim takes now: the paper position's ready ones, or the oldest ready ones of the
// wallet's queue at the block, at most as many as one claim takes.
async function readyParts(parts: PlanParts, ask: PlanAsk): Promise<ClaimParts> {
  const { at, facts } = parts;
  const paper = ask.request.paper;
  if (paper !== undefined) {
    const timeMs = Number(at.time * msPerSecond);
    const waiting = paper.parts.findIndex((part) => part.readyAtMs > timeMs);
    const ready = waiting === -1 ? paper.parts : paper.parts.slice(0, waiting);
    return claimPartsOf(ready, paper.parts[ready.length]);
  }
  const { credit } = facts;
  const [count, next] = await readEach(at, [
    creditOfWalletRead(credit, "pendingUnbondRequest", ask.wallet),
    creditOfWalletRead(credit, "unbondSequence", ask.wallet),
  ]);
  const head = {
    credit,
    count: required(count, "a count of unbond requests"),
    next: required(next, "an unbond sequence"),
  };
  const [queue = []] = await readQueues(at, ask.wallet, [head]);
  const ready = readyRequests(queue, at.time);
  const waiting = queue[ready.length];
  const toPart = (request: (typeof queue)[number]) => partOf(at, credit, request);
  return claimPartsOf(ready.map(toPart), waiting === undefined ? undefined : toPart(waiting));
}

// A claim, in StakeHub's order: nothing ready first, then a payment the wallet cannot take, since
// StakeHub pays with 5,000 gas and a wallet's code may need more.
async function planClaim(parts: PlanParts, ask: PlanAsk): Promise<StakePlanned> {
  const { at, base } = parts;
  const { ready, nextReadyAtMs } = await readyParts(parts, ask);
  if (ready.length === 0) {
    const facts = nextReadyAtMs === undefined ? {} : { facts: { readyAtMs: nextReadyAtMs } };
    return { ...err("nothing_to_claim"), ...facts };
  }
  if (ask.request.paper === undefined && (await holdsCode(at, ask.wallet))) {
    return err("claim_unpayable");
  }
  const moved = coin(
    at,
    ready.reduce((sum, part) => sum + part.amount.base, 0n),
  );
  const refs = ready.map((part) => part.ref);
  return ok({ ...base, action: "claim", value: coin(at, 0n), moved, parts: refs });
}

/**
 * Plans the move at the read's block, in the order StakeHub would refuse it: paused, a wallet it
 * refuses, an operator it does not list; then a stake under the least stake or to a jailed
 * validator, an unstake with nothing staked or of more than the stake is worth, a claim with
 * nothing ready or to a wallet whose code StakeHub's payment cannot reach. A stake carries the
 * shares it mints; an unstake the fewest shares worth at least its amount, every share for the
 * whole stake; a claim the ready parts at the front of the queue. With the request's paper
 * position, shares and parts come from it, and nothing of the wallet's own is read.
 */
export async function planStakeMove(at: OptionsRead, ask: PlanAsk): Promise<StakePlanned> {
  const facts = await readFacts(at, ask);
  if (!facts.ok) {
    return facts;
  }
  const { request } = ask;
  const { name, commissionBps, aprBps, jailed, numbers } = facts.value;
  const base: PlanBase = {
    wallet: request.wallet,
    validator: request.validator,
    validatorName: name,
    commissionBps,
    ...(aprBps === undefined ? {} : { aprBps }),
    jailed,
    paper: request.paper !== undefined,
    unbondingSeconds: Number(numbers.unbondSeconds),
    plannedAtMs: Number(at.time * msPerSecond),
  };
  const parts = { at, facts: facts.value, base };
  if (request.action === "stake") {
    return planStake(parts, request);
  }
  return request.action === "unstake"
    ? planUnstake(parts, { ...ask, amount: request.amount })
    : planClaim(parts, ask);
}
