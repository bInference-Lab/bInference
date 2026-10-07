import type { TxDraft, TxPreparer } from "@binference/chain";
import { BinferenceError, err, ok } from "@binference/core";
import { toHex } from "viem";
import { decodeEvmDraft, type EvmDraftCall } from "../drafts/evm-draft.js";
import type { EvmChain } from "../evm-chain.js";
import { readFees } from "../fees/read-fees.js";
import { quantitySchema } from "../rpc/evm-wire.schema.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { encodeEvmTransaction } from "../signing/evm-transaction.js";

/** What the EVM transaction preparer reads: one chain through its RPC failover, and its fee cap. */
export interface EvmTxPreparerOptions {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
  /** The chain's network fee cap, in wei per gas (decision 0102). */
  readonly networkFeeCap: bigint;
  /**
   * Gas added on top of the node's estimate, in basis points: the state can move between the
   * estimate and the block. 2,000 (20%) when absent.
   */
  readonly gasHeadroomBps?: number;
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

/**
 * Creates the `TxPreparer` of one EVM chain: the gas from `eth_estimateGas` on the latest state
 * plus the headroom, and the fees of {@link readFees}, marked when they pass the network fee cap.
 * A call the node answers with an error, such as a revert or too little balance, would fail now
 * and is `would_fail`. A draft of another chain, or one the family cannot read, is a fault.
 */
export function createEvmTxPreparer(options: EvmTxPreparerOptions): TxPreparer {
  const { rpc, chain } = options;
  const headroomBps = BigInt(options.gasHeadroomBps ?? defaultHeadroomBps);
  return {
    async prepare({ draft, nonce }, { signal }) {
      signal.throwIfAborted();
      const call = callOn(chain, draft);
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
        readFees(rpc, { maxFeePerGasCap: options.networkFeeCap, signal }),
      ]);
      if (estimate.kind === "error") {
        return err("would_fail");
      }
      const gas = (estimate.value * (bpsPerWhole + headroomBps)) / bpsPerWhole;
      const { fees, isAboveCap } = reading;
      const unsigned = encodeEvmTransaction(chain, { ...call, nonce, gas, fees });
      return ok({ unsigned, feePerGasBase: fees.maxFeePerGas, isAboveFeeCap: isAboveCap });
    },
  };
}
