import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  type StakingHolding,
  type UnbondingPart,
} from "@binference/plugin-sdk";
import type { Address } from "viem";
import { maxClaimParts } from "../calls/decode-stake.js";
import {
  creditOfWalletRead,
  type UnbondRequest,
  unbondRequestRead,
  validatorsRead,
} from "./hub-calls.js";
import { type BlockRead, readEach, required } from "./hub-read.js";
import type { OptionsRead } from "./read-options.js";

const msPerSecond = 1_000n;

/** A wallet's waiting unstake at a credit contract, with its sequence number there. */
export interface QueuedRequest extends UnbondRequest {
  readonly sequence: bigint;
}

/** The venue's own reference of an unstake: its credit contract and its sequence number there. */
export function requestRefOf(credit: Address, sequence: bigint): string {
  return `${credit}:${sequence.toString()}`;
}

/**
 * The oldest of a wallet's waiting unstakes that a claim takes now: StakeHub claims from the front
 * of the queue and stops at the first one still locked.
 */
export function readyRequests<T extends UnbondRequest>(
  requests: readonly T[],
  time: bigint,
): readonly T[] {
  const locked = requests.findIndex((request) => request.unlockTime > time);
  return locked === -1 ? requests : requests.slice(0, locked);
}

/** An unstake's part as the port gives it. */
export function partOf(
  at: Pick<OptionsRead, "coin">,
  credit: Address,
  request: QueuedRequest,
): UnbondingPart {
  return {
    ref: requestRefOf(credit, request.sequence),
    amount: { asset: at.coin, base: request.bnbAmount },
    readyAtMs: Number(request.unlockTime * msPerSecond),
  };
}

/** What a wallet's queue at one credit contract holds: its length, and the next sequence number. */
export interface QueueHead {
  readonly credit: Address;
  readonly count: bigint;
  readonly next: bigint;
}

/**
 * A wallet's waiting unstakes at each credit contract given, oldest first, at most 1,000 at each,
 * each with its sequence number: StakeCredit queues them in the order of their sequence numbers
 * and claims from the front, so the front one's is the next number less the count.
 */
export async function readQueues(
  at: BlockRead,
  wallet: Address,
  heads: readonly QueueHead[],
): Promise<readonly (readonly QueuedRequest[])[]> {
  const read = heads.map((head) => (head.count < maxClaimParts ? head.count : maxClaimParts));
  const reads = heads.flatMap(({ credit }, place) =>
    Array.from({ length: Number(read[place] ?? 0n) }, (_, index) =>
      unbondRequestRead(credit, wallet, BigInt(index)),
    ),
  );
  const answers = await readEach(at, reads);
  let next = 0;
  return heads.map((head, index) => {
    const length = Number(read[index] ?? 0n);
    const part = answers.slice(next, next + length);
    next += length;
    const first = head.next - head.count;
    return part.map((answer, place) => queued(answer, first + BigInt(place)));
  });
}

function queued(answer: UnbondRequest | undefined, sequence: bigint): QueuedRequest {
  return { ...required(answer, "an unbond request"), sequence };
}

interface CreditHolding extends QueueHead {
  readonly operator: Address;
  readonly shares: bigint;
  readonly pooled: bigint;
}

function holdingOf(
  at: OptionsRead,
  wallet: AccountRef,
  held: CreditHolding & { readonly requests: readonly QueuedRequest[] },
): StakingHolding {
  const coin = (base: bigint) => ({ asset: at.coin, base });
  const ready = readyRequests(held.requests, at.time);
  const claimable = ready.reduce((sum, request) => sum + request.bnbAmount, 0n);
  const receipt = assetRefSchema.parse(`${at.chain}/erc20:${held.credit}`);
  return {
    wallet,
    validator: accountRefSchema.parse(`${at.chain}:${held.operator}`),
    staked: { asset: receipt, base: held.shares },
    stakedValue: coin(held.pooled),
    unbonding: held.requests.map((request) => partOf(at, held.credit, request)),
    claimable: coin(claimable),
    ...(held.count > maxClaimParts ? { unbondingCut: true as const } : {}),
  };
}

// The wallet's shares, their worth, its queue's length and next sequence number at each credit
// contract; a validator it holds nothing with is left out.
async function creditHoldings(
  at: OptionsRead,
  address: Address,
): Promise<readonly CreditHolding[]> {
  const [list] = await readEach(at, [validatorsRead(at.hub)]);
  const { operators, credits } = required(list, "getValidators");
  const names = ["balanceOf", "getPooledBNB", "pendingUnbondRequest", "unbondSequence"] as const;
  const [shares, pooled, counts, sequences] = await Promise.all(
    names.map(async (name) =>
      readEach(
        at,
        credits.map((credit) => creditOfWalletRead(credit, name, address)),
      ),
    ),
  );
  return credits.flatMap((credit, index) => {
    const held = required(shares?.[index], "a credit balance");
    const count = required(counts?.[index], "a count of unbond requests");
    const operator = operators[index];
    if ((held === 0n && count === 0n) || operator === undefined) {
      return [];
    }
    const worth = held === 0n ? 0n : required(pooled?.[index], "a stake's worth");
    const next = required(sequences?.[index], "an unbond sequence");
    return [{ operator, credit, shares: held, pooled: worth, count, next }];
  });
}

/**
 * Reads what the wallet holds with each validator StakeHub lists, at the read's block: its credit
 * shares, what they are worth in coin, and its waiting unstakes with their references, those a
 * claim takes now counted apart. A validator it holds nothing with is left out; a queue of more
 * than 1,000 is read up to its 1,000 oldest, and the holding marked cut. A credit contract that
 * cannot price shares it holds, or a revert of a call it always answers, is `stakehub.read_failed`.
 */
export async function readHoldings(
  at: OptionsRead,
  wallet: AccountRef,
  address: Address,
): Promise<readonly StakingHolding[]> {
  const found = await creditHoldings(at, address);
  const requests = await readQueues(at, address, found);
  return found.map((held, index) =>
    holdingOf(at, wallet, { ...held, requests: requests[index] ?? [] }),
  );
}
