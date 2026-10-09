import { type AccountRef, isTxHash, type TxHash } from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import { type Address, toHex } from "viem";
import { z } from "zod";
import type { EvmChain } from "../evm-chain.js";
import { addressSchema, quantitySchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { accountAddressOn } from "./account-address-on.js";
import { type CallFrame, callFrameSchema } from "./call-frame.schema.js";

/** What the native coin an account received is read through: the chain's RPC, and a tracer. */
export interface NativeReceivedSource {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
  /** A node that answers `debug_traceTransaction`, asked once the others pruned the state. */
  readonly tracer?: RpcFailover;
}

/** One of the account's own transactions in the block: its hash and what it paid. */
interface OwnTransaction {
  readonly hash: TxHash;
  readonly hasRun: boolean;
  /** Its fee, and its value when it ran. */
  readonly paidBase: bigint;
}

const blockSchema = z.looseObject({
  transactions: z.array(
    z.looseObject({
      hash: z.string().refine(isTxHash),
      from: addressSchema,
      value: quantitySchema,
    }),
  ),
});
const feeSchema = z.looseObject({
  status: z.enum(["0x0", "0x1"]),
  gasUsed: quantitySchema,
  effectiveGasPrice: quantitySchema,
});

function blockMissing(block: bigint): BinferenceError {
  return new BinferenceError({
    code: "chain.block_missing",
    message: `No node holds block ${block.toString()} yet.`,
    retryable: true,
    details: { block: block.toString() },
  });
}

async function ownTransactions(
  source: NativeReceivedSource,
  read: { readonly address: Address; readonly block: bigint },
  signal: AbortSignal,
): Promise<readonly OwnTransaction[]> {
  const { rpc } = source;
  const found = await requestResult(rpc, {
    method: "eth_getBlockByNumber",
    params: [toHex(read.block), true],
    result: blockSchema.nullable(),
    signal,
  });
  if (found === null) {
    throw blockMissing(read.block);
  }
  const own = found.transactions.filter(({ from }) => from === read.address);
  return Promise.all(
    own.map(async ({ hash, value }) => {
      const fee = await requestResult(rpc, {
        method: "eth_getTransactionReceipt",
        params: [hash],
        result: feeSchema,
        signal,
      });
      const hasRun = fee.status === "0x1";
      const paidBase = fee.gasUsed * fee.effectiveGasPrice + (hasRun ? value : 0n);
      return { hash, hasRun, paidBase };
    }),
  );
}

function isStateMissing(error: Readonly<Error>): boolean {
  return error instanceof BinferenceError && error.code === "chain.state_missing";
}

// The balance after the block less the balance before it, or `undefined` once the state is gone.
async function balanceChange(
  source: NativeReceivedSource,
  read: { readonly address: Address; readonly block: bigint },
  signal: AbortSignal,
): Promise<bigint | undefined> {
  const balanceAt = async (block: bigint) =>
    requestResult(source.rpc, {
      method: "eth_getBalance",
      params: [read.address, toHex(block)],
      result: quantitySchema,
      signal,
    });
  try {
    const [before, after] = await Promise.all([balanceAt(read.block - 1n), balanceAt(read.block)]);
    return after - before;
  } catch (error) {
    if (error instanceof Error && isStateMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

// Native coin the calls under a frame sent to the address; a call that failed undid its own
// value and every call under it.
function innerReceived(frame: CallFrame, address: Address): bigint {
  return (frame.calls ?? []).reduce((sum, call) => {
    if (call.error !== undefined) {
      return sum;
    }
    const value = call.to === address ? (call.value ?? 0n) : 0n;
    return sum + value + innerReceived(call, address);
  }, 0n);
}

async function traced(
  tracer: RpcFailover,
  read: { readonly address: Address; readonly own: readonly OwnTransaction[] },
  signal: AbortSignal,
): Promise<Result<bigint, "state_gone">> {
  const ran = read.own.filter(({ hasRun }) => hasRun);
  try {
    const frames = await Promise.all(
      ran.map(async ({ hash }) =>
        requestResult(tracer, {
          method: "debug_traceTransaction",
          params: [hash, { tracer: "callTracer" }],
          result: callFrameSchema,
          signal,
        }),
      ),
    );
    return ok(frames.reduce((sum, frame) => sum + innerReceived(frame, read.address), 0n));
  } catch (error) {
    if (error instanceof Error && isStateMissing(error)) {
      return err("state_gone");
    }
    throw error;
  }
}

/**
 * The native coin an account received in a block without a log (decision 0108): its balance
 * after the block less its balance before, plus the fees of its own transactions in the block and
 * the values of those that ran; below 0 counts as 0. Once every node pruned the state before the
 * block, the tracer's `callTracer` frames of the account's transactions that ran say what their
 * inner calls sent it; with no tracer, or one that pruned it too, it is `state_gone`.
 */
export async function readNativeReceived(
  source: NativeReceivedSource,
  query: { readonly account: AccountRef; readonly block: bigint },
  signal: AbortSignal,
): Promise<Result<bigint, "state_gone">> {
  const address = accountAddressOn(source.chain, query.account);
  const read = { address, block: query.block };
  const own = await ownTransactions(source, read, signal);
  const change = await balanceChange(source, read, signal);
  if (change !== undefined) {
    const received = own.reduce((sum, { paidBase }) => sum + paidBase, change);
    return ok(received > 0n ? received : 0n);
  }
  return source.tracer === undefined
    ? err("state_gone")
    : traced(source.tracer, { address, own }, signal);
}
