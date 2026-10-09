import type { AssetTransfer, TxHash } from "@binference/chain";
import { z } from "zod";
import { type EvmChain, evmAccountRef } from "../evm-chain.js";
import { addressSchema, quantitySchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { evmLogSchema } from "../simulation/simulation-reply.schema.js";
import { readTransfers } from "../simulation/transfer-logs.js";

/** What the transfers of a mined transaction are read through: one chain's RPC failover. */
export interface EvmTransfersSource {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
}

const receiptLogsSchema = z
  .looseObject({ status: z.enum(["0x0", "0x1"]), logs: z.array(evmLogSchema) })
  .nullable();

// A contract creation has no `to`; its value goes to the new contract, which this read skips.
const transactionSchema = z.looseObject({
  from: addressSchema,
  to: addressSchema.nullable(),
  value: quantitySchema,
});

async function nativeValue(
  source: EvmTransfersSource,
  hash: TxHash,
  signal: AbortSignal,
): Promise<readonly AssetTransfer[]> {
  const { rpc, chain } = source;
  const sent = await requestResult(rpc, {
    method: "eth_getTransactionByHash",
    params: [hash],
    result: transactionSchema,
    signal,
  });
  if (sent.to === null || sent.value === 0n) {
    return [];
  }
  const from = evmAccountRef(chain, sent.from);
  const to = evmAccountRef(chain, sent.to);
  return [{ from, to, amount: { asset: chain.nativeAsset, base: sent.value } }];
}

/**
 * The transfers of a transaction a block holds: the native coin its own value sends, then the
 * ERC-20 `Transfer` logs of its receipt, in their order. A reverted transaction moved nothing,
 * and one no block holds reads as `undefined`. Native coin an inner call sends emits no log, so
 * it is not among them.
 */
export async function readEvmTransfers(
  source: EvmTransfersSource,
  hash: TxHash,
  signal: AbortSignal,
): Promise<readonly AssetTransfer[] | undefined> {
  const receipt = await requestResult(source.rpc, {
    method: "eth_getTransactionReceipt",
    params: [hash],
    result: receiptLogsSchema,
    signal,
  });
  if (receipt === null) {
    return undefined;
  }
  if (receipt.status === "0x0") {
    return [];
  }
  const value = await nativeValue(source, hash, signal);
  return [...value, ...readTransfers(source.chain, receipt.logs)];
}
