import {
  leastReplacementFee,
  type PreparedReplacement,
  type PreparedTx,
  type ReplaceRequest,
  type SignedTx,
  type StepReplacement,
  type TxDraft,
  type TxPreparer,
} from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import { type Address, getAddress, type TransactionSerializableEIP1559, toHex } from "viem";
import { decodeEvmDraft, type EvmDraftCall } from "../drafts/evm-draft.js";
import { type EvmChain, evmAccountRef } from "../evm-chain.js";
import { type EvmFees, readFees } from "../fees/read-fees.js";
import { quantitySchema } from "../rpc/evm-wire.schema.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { encodeEvmTransaction, parseSerialized } from "../signing/evm-transaction.js";
import { accountAddressOn } from "./account-address-on.js";

/** What the EVM transaction preparer reads: one chain through its RPC failover, and its fee cap. */
export interface EvmTxPreparerOptions {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
  /** The chain's network fee cap, in wei per gas (decision 0102). */
  readonly networkFeeCapWeiPerGas: bigint;
  /**
   * Gas added on top of the node's estimate, in basis points: the state can move between the
   * estimate and the block. 2,000 (20%) when absent.
   */
  readonly gasHeadroomBps?: number;
}

/** A transaction signed before, read back for the one that takes its nonce. */
interface SignedCall {
  readonly call: Omit<EvmDraftCall, "from">;
  readonly nonce: number;
  readonly fees: EvmFees;
}

const bpsPerWhole = 10_000n;
const defaultHeadroomBps = 2_000;

function callOn(chain: EvmChain, draft: TxDraft): EvmDraftCall {
  const call = decodeEvmDraft(draft);
  if (draft.chain !== chain.ref || !call.ok) {
    throw new BinferenceError({
      code: "chain.bad_draft",
      message: `A draft to prepare is not a call on ${chain.name}.`,
      details: { chain: draft.chain },
    });
  }
  return call.value;
}

// The signed bytes as a type-2 call on the chain; anything else is a fault.
function signedOn(
  chain: EvmChain,
  signed: SignedTx,
): TransactionSerializableEIP1559 & { readonly to: Address } {
  const parsed = signed.chain === chain.ref ? parseSerialized(signed.raw) : undefined;
  if (parsed?.type !== "eip1559" || !parsed.to || parsed.chainId !== chain.chainId) {
    throw new BinferenceError({
      code: "chain.bad_transaction",
      message: `The signed bytes to replace are not a type-2 call on ${chain.name}.`,
      details: { chain: signed.chain },
    });
  }
  return { ...parsed, to: parsed.to };
}

// The signed call, nonce and fees; the encoding leaves a zero field empty.
function signedCallOn(chain: EvmChain, signed: SignedTx): SignedCall {
  const parsed = signedOn(chain, signed);
  const { to, value = 0n, data = "0x", nonce = 0 } = parsed;
  const { maxFeePerGas = 0n, maxPriorityFeePerGas = 0n } = parsed;
  return {
    call: { to: getAddress(to), value, data },
    nonce,
    fees: { maxFeePerGas, maxPriorityFeePerGas },
  };
}

function raisedFee(fee: bigint, before: bigint): bigint {
  const least = leastReplacementFee(before);
  return fee > least ? fee : least;
}

// Each fee is the chain's now, raised where needed to replace the signed transaction's.
function raisedFees(now: EvmFees, signed: EvmFees): EvmFees {
  return {
    maxFeePerGas: raisedFee(now.maxFeePerGas, signed.maxFeePerGas),
    maxPriorityFeePerGas: raisedFee(now.maxPriorityFeePerGas, signed.maxPriorityFeePerGas),
  };
}

// The gas from `eth_estimateGas` on the latest state plus the headroom, and the fees read now,
// raised to `floor` when one is given. A call the node answers with an error would fail now.
async function prepareCall(
  options: EvmTxPreparerOptions,
  call: EvmDraftCall,
  at: { readonly nonce: number; readonly floor?: EvmFees; readonly signal: AbortSignal },
): Promise<Result<PreparedTx, "would_fail">> {
  const { rpc, chain, networkFeeCapWeiPerGas } = options;
  const { signal } = at;
  const headroomBps = BigInt(options.gasHeadroomBps ?? defaultHeadroomBps);
  const [estimate, reading] = await Promise.all([
    rpc.request({
      method: "eth_estimateGas",
      params: [
        { from: call.from, to: call.to, value: toHex(call.value), data: call.data },
        "latest",
      ],
      result: quantitySchema,
      signal,
    }),
    readFees(rpc, { networkFeeCapWeiPerGas, signal }),
  ]);
  if (estimate.kind === "error") {
    return err("would_fail");
  }
  const gas = (estimate.value * (bpsPerWhole + headroomBps)) / bpsPerWhole;
  const fees = at.floor === undefined ? reading.fees : raisedFees(reading.fees, at.floor);
  const unsigned = encodeEvmTransaction(chain, { ...call, nonce: at.nonce, gas, fees });
  const feePerGasBase = fees.maxFeePerGas;
  return ok({ unsigned, feePerGasBase, isAboveFeeCap: feePerGasBase > networkFeeCapWeiPerGas });
}

// A speed-up repeats the signed call; a cancel sends nothing to the sender itself.
async function replaceSigned(
  options: EvmTxPreparerOptions,
  request: ReplaceRequest,
  signal: AbortSignal,
): Promise<Result<PreparedReplacement, "would_fail">> {
  const { chain } = options;
  const from = accountAddressOn(chain, request.from);
  const signed = signedCallOn(chain, request.replaced);
  const { nonce } = signed;
  const call =
    request.kind === "cancel" ? { to: from, value: 0n, data: "0x" as const } : signed.call;
  const prepared = await prepareCall(
    options,
    { from, ...call },
    { nonce, floor: signed.fees, signal },
  );
  if (!prepared.ok) {
    return prepared;
  }
  const { to, value, data } = signed.call;
  const replaces: StepReplacement =
    request.kind === "cancel"
      ? { kind: "cancel", nonce }
      : { kind: "speedUp", nonce, original: { to: evmAccountRef(chain, to), value, data } };
  return ok({ ...prepared.value, replaces });
}

/**
 * Creates the `TxPreparer` of one EVM chain: the gas from `eth_estimateGas` on the latest state
 * plus the headroom, and the fees of {@link readFees}, marked when they pass the network fee cap.
 * A call the node answers with an error, such as a revert or too little balance, would fail now
 * and is `would_fail`. A replacement raises each fee to at least `leastReplacementFee` of the
 * signed transaction's, as the chain's transaction pool asks of both fees. A draft of another
 * chain, one the family cannot read, or signed bytes that are no type-2 call, are a fault.
 */
export function createEvmTxPreparer(options: EvmTxPreparerOptions): TxPreparer {
  const { chain } = options;
  return {
    async prepare({ draft, nonce }, { signal }) {
      signal.throwIfAborted();
      return prepareCall(options, callOn(chain, draft), { nonce, signal });
    },
    async replace(request, { signal }) {
      signal.throwIfAborted();
      return replaceSigned(options, request, signal);
    },
  };
}
