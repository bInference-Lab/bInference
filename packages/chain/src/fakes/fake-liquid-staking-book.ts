import { type Bps, err, ok, type Result } from "@binference/core";
import type { Amount } from "../amount.js";
import type { AccountRef } from "../caip/account-ref.js";
import { type AssetRef, assetRefSchema } from "../caip/asset-ref.js";
import type { DecodedStake, LandedStake, UnbondingPart } from "../staking/staking-terms.js";
import { isTxHash, type TxDraft, type TxHash } from "../transaction.js";
import { fakeCallOf, isFakeUnsigned } from "./fake-draft.js";
import { account, amount, wrong } from "./fake-staking-book.js";

/** What the fake liquid staking venue starts from. */
export interface FakeLiquidStakingOptions {
  /** The name the venue gives its pool. */
  readonly name: string;
  /** What the venue keeps of the pool's rewards. */
  readonly commissionBps: Bps;
  /** The least coin one stake puts in. */
  readonly minStakeBase: bigint;
  /** The least coin one unstake takes out. */
  readonly minUnstakeBase: bigint;
  /** The earliest an unstake's coin is released, after its request. */
  readonly unbondingSeconds: number;
  /** What `units` receipt units are worth: `coin` of the chain's coin. */
  readonly rate: { readonly coin: bigint; readonly units: bigint };
  readonly nowMs: number;
}

/** An unstake's request in the venue's queue. */
export interface QueuedRequest {
  readonly uuid: number;
  readonly units: bigint;
  readonly coin: bigint;
  readonly startMs: number;
}

/** What one wallet holds with the pool: receipt units, its requests, and its allowance to it. */
interface PoolHolding {
  readonly units: bigint;
  readonly requests: readonly QueuedRequest[];
  readonly allowance: bigint;
}

/** The fake pool's state: holdings by wallet, its moves by hash, its clock, pause and queue. */
export interface PoolBook {
  readonly options: FakeLiquidStakingOptions;
  readonly nowMs: () => number;
  readonly holding: (wallet: AccountRef) => PoolHolding;
  readonly put: (wallet: AccountRef, holding: PoolHolding) => void;
  readonly totalUnits: () => bigint;
  readonly nextUuid: () => number;
  readonly land: (move: LandedStake) => TxHash;
  readonly landed: (hash: TxHash) => LandedStake | undefined;
  readonly isPaused: () => boolean;
  readonly isHeld: () => boolean;
  readonly wait: (seconds: number) => void;
  readonly pause: () => void;
  readonly unpause: () => void;
  readonly holdQueue: () => void;
  readonly releaseQueue: () => void;
}

export const poolAddress = "0x000000e1";
export const receiptAddress = "0x000000e2";
export const pool: AccountRef = account(poolAddress);
export const receipt: AssetRef = assetRefSchema.parse(`fake:1/token:${receiptAddress}`);
const msPerSecond = 1_000;
const empty: PoolHolding = { units: 0n, requests: [], allowance: 0n };

/** The coin some receipt units are worth, rounded down. */
export const coinOf = (book: PoolBook, units: bigint): bigint =>
  (units * book.options.rate.coin) / book.options.rate.units;

/** The receipt units some coin mints, rounded down. */
export const unitsOf = (book: PoolBook, coin: bigint): bigint =>
  (coin * book.options.rate.units) / book.options.rate.coin;

/** Creates the fake pool's book. */
export function createPoolBook(options: FakeLiquidStakingOptions): PoolBook {
  const holdings = new Map<AccountRef, PoolHolding>();
  const moves = new Map<string, LandedStake>();
  const state = { nowMs: options.nowMs, uuid: 0, isPaused: false, isHeld: false };
  return {
    options,
    nowMs: () => state.nowMs,
    holding: (wallet) => holdings.get(wallet) ?? empty,
    put: (wallet, holding) => holdings.set(wallet, holding),
    totalUnits: () => [...holdings.values()].reduce((sum, held) => sum + held.units, 0n),
    nextUuid: () => {
      state.uuid += 1;
      return state.uuid;
    },
    land: (move) => {
      const hash = `0x${(moves.size + 1).toString(16).padStart(8, "0")}`;
      if (!isTxHash(hash)) {
        throw wrong("The fake pool made a hash outside the id grammar.");
      }
      moves.set(hash, move);
      return hash;
    },
    landed: (hash) => moves.get(hash),
    isPaused: () => state.isPaused,
    isHeld: () => state.isHeld,
    wait: (seconds) => {
      state.nowMs += seconds * msPerSecond;
    },
    pause: () => {
      state.isPaused = true;
    },
    unpause: () => {
      state.isPaused = false;
    },
    holdQueue: () => {
      state.isHeld = true;
    },
    releaseQueue: () => {
      state.isHeld = false;
    },
  };
}

/** Whether the queue released the request: its earliest time came and the queue is not held. */
export function isReleased(book: PoolBook, request: QueuedRequest): boolean {
  return !book.isHeld() && earliestOf(book, request) <= book.nowMs();
}

function earliestOf(book: PoolBook, request: QueuedRequest): number {
  return request.startMs + book.options.unbondingSeconds * msPerSecond;
}

/**
 * A request as a part of the wallet's unbonding: ready by its read once released, else queued, at
 * its earliest time and never before a millisecond after its read.
 */
export function partOf(book: PoolBook, request: QueuedRequest): UnbondingPart {
  const now = book.nowMs();
  const earliest = earliestOf(book, request);
  const part = { ref: String(request.uuid), amount: amount(request.coin) };
  return isReleased(book, request)
    ? { ...part, readyAtMs: Math.min(earliest, now) }
    : { ...part, readyAtMs: Math.max(earliest, now + 1), queued: true };
}

type PoolMove = Omit<DecodedStake, "contract" | "validator" | "credits">;

function countOf(word: string | undefined): bigint | undefined {
  return word !== undefined && isFakeUnsigned(word) && word !== "0" ? BigInt(word) : undefined;
}

function moveOf(value: bigint, words: readonly string[]): PoolMove | undefined {
  const [name, count, ...rest] = words;
  if (rest.length > 0) {
    return undefined;
  }
  if (name === "deposit" && count === undefined) {
    return value > 0n ? { action: "stake", value } : undefined;
  }
  const units = countOf(count);
  if (value !== 0n || units === undefined) {
    return undefined;
  }
  return name === "requestWithdraw" ? { action: "unstake", value, shares: units } : undefined;
}

// A claim names one request by its id, any unsigned number, 0 for a paper claim's.
function claimOf(value: bigint, words: readonly string[]): PoolMove | undefined {
  const [name, id, ...rest] = words;
  const isId = id !== undefined && isFakeUnsigned(id);
  return name === "claimWithdrawByUUID" && isId && rest.length === 0 && value === 0n
    ? { action: "claim", value, parts: 1, refs: [id] }
    : undefined;
}

/** Decodes the three pool calls the fake builds: deposit, an unstake's request and its claim. */
export function decodePool(draft: TxDraft): Result<DecodedStake, "unknown_call"> {
  const call = fakeCallOf(draft);
  const words = call?.data.split(",") ?? [];
  const move =
    call?.to === poolAddress
      ? (moveOf(call.value, words) ?? claimOf(call.value, words))
      : undefined;
  return move === undefined
    ? err("unknown_call")
    : ok({ ...move, contract: pool, validator: pool, credits: draft.from });
}

/** The request id a claim call names, in decimal. */
export function claimedUuid(draft: TxDraft): string | undefined {
  const [, word] = fakeCallOf(draft)?.data.split(",") ?? [];
  return word;
}

/** The receipt units as an amount of the pool's receipt token. */
export const units = (base: bigint): Amount => amount(base, receipt);

/** Claims the wallet's released request with that id outside the venue's moves, as a bot may. */
export function claimForWallet(book: PoolBook, wallet: AccountRef, ref: string): void {
  const held = book.holding(wallet);
  const taken = held.requests.find((item) => String(item.uuid) === ref && isReleased(book, item));
  if (taken === undefined) {
    throw wrong("The fake pool claims only a released request.");
  }
  book.put(wallet, { ...held, requests: held.requests.filter((item) => item !== taken) });
}
