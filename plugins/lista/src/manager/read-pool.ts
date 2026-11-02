import { type Bps, bpsSchema } from "@binference/plugin-sdk";
import type { Address } from "viem";
import {
  balanceRead,
  flagOf,
  type ListaAt,
  plainRead,
  readViews,
  requestsOf,
  requestsRead,
  uintOf,
  type ViewRead,
  type ViewValue,
  type WithdrawalRequest,
} from "./manager-read.js";

/** Lista's pool at one block, as its stake manager and StakeHub tell it. */
interface PoolState {
  readonly block: bigint;
  readonly timeMs: number;
  readonly paused: boolean;
  /** The least coin one withdrawal request takes out. */
  readonly minBnb: bigint;
  /** What Lista keeps of the pool's rewards. */
  readonly commissionBps: Bps;
  /** slisBNB's supply and the coin it is worth together. */
  readonly supply: bigint;
  readonly pooled: bigint;
  /** StakeHub's unbonding time, the least a request waits in Lista's queue. */
  readonly unbondingSeconds: number;
}

/** What one read asks besides the pool: a wallet's slisBNB and requests. */
export interface PoolAsk {
  readonly wallet?: Address;
}

/** The pool, and the answers to the ask, read at one block. */
export interface PoolRead {
  readonly state: PoolState;
  /** The wallet's slisBNB units. */
  readonly balance?: bigint;
  /** The wallet's withdrawal requests, as the stake manager lists them. */
  readonly requests?: readonly WithdrawalRequest[];
}

// `synFee` is a share of 10^10; a basis point is 10^6 of it.
const feeUnitsPerBps = 1_000_000n;
const msPerSecond = 1_000;

function baseReads(at: ListaAt): readonly ViewRead[] {
  const { manager, token, stakeHub, multicall } = at;
  return [
    plainRead(multicall, "getBlockNumber"),
    plainRead(multicall, "getCurrentBlockTimestamp"),
    plainRead(manager, "paused"),
    plainRead(manager, "minBnb"),
    plainRead(manager, "synFee"),
    plainRead(token, "totalSupply"),
    plainRead(manager, "getTotalPooledBnb"),
    plainRead(stakeHub, "unbondPeriod"),
  ];
}

function askReads(at: ListaAt, { wallet }: PoolAsk): readonly ViewRead[] {
  return wallet === undefined
    ? []
    : [balanceRead(at.token, wallet), requestsRead(at.manager, wallet)];
}

function stateOf(answers: readonly (ViewValue | undefined)[]): PoolState {
  const [block, time, paused, minBnb, fee, supply, pooled, unbonding] = answers;
  const commission = uintOf(fee, "synFee") / feeUnitsPerBps;
  return {
    block: uintOf(block, "the block number"),
    timeMs: Number(uintOf(time, "the block time")) * msPerSecond,
    paused: flagOf(paused, "paused"),
    minBnb: uintOf(minBnb, "minBnb"),
    commissionBps: bpsSchema.parse(Number(commission > 10_000n ? 10_000n : commission)),
    supply: uintOf(supply, "slisBNB's supply"),
    pooled: uintOf(pooled, "getTotalPooledBnb"),
    unbondingSeconds: Number(uintOf(unbonding, "StakeHub's unbondPeriod")),
  };
}

/**
 * Reads Lista's pool at the latest block in one Multicall3 call, with the wallet's slisBNB and
 * requests at that block when the ask names one. A view Lista always answers that reverts, or
 * an answer outside its shape, is `lista.read_failed`; no node answering is `chain.rpc_down`.
 */
export async function readPool(at: ListaAt, ask: PoolAsk = {}): Promise<PoolRead> {
  const base = baseReads(at);
  const answers = await readViews(at, [...base, ...askReads(at, ask)]);
  const [balance, requests] = answers.slice(base.length);
  const held =
    ask.wallet === undefined
      ? {}
      : { balance: uintOf(balance, "slisBNB's balance"), requests: requestsOf(requests) };
  return {
    state: stateOf(answers),
    ...held,
  };
}
