import {
  type ChainHead,
  type ChainRef,
  type FinalityRule,
  type ReceiptReader,
  type TxReceipt,
  txReceiptSchema,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { z } from "zod";
import type { EvmChain } from "../evm-chain.js";
import { hexSchema, quantitySchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";

/** What the EVM receipt reader reads: one chain through its RPC failover, by its finality rule. */
export interface EvmReceiptReaderOptions {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
  readonly finality: FinalityRule;
}

const hash32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

// The execution APIs' receipt: status 0x1 is success, 0x0 a revert; the fee per gas a type-2
// transaction paid is `effectiveGasPrice`.
const rpcReceiptSchema = z.looseObject({
  transactionHash: hash32Schema,
  blockNumber: quantitySchema,
  blockHash: hash32Schema,
  status: z.enum(["0x0", "0x1"]),
  gasUsed: quantitySchema,
  effectiveGasPrice: quantitySchema,
});

const receiptResultSchema = rpcReceiptSchema.nullable();
const blockNumberSchema = z.looseObject({ number: quantitySchema, hash: hexSchema });

function served(chain: EvmChain, asked: ChainRef): void {
  if (asked !== chain.ref) {
    throw new BinferenceError({
      code: "chain.unknown_chain",
      message: `This receipt reader reads ${chain.name} only.`,
      details: { chain: asked },
    });
  }
}

function receiptOf(rpc: z.infer<typeof rpcReceiptSchema>): TxReceipt {
  return txReceiptSchema.parse({
    hash: rpc.transactionHash.toLowerCase(),
    block: { number: rpc.blockNumber.toString(), hash: rpc.blockHash.toLowerCase() },
    status: rpc.status === "0x1" ? "success" : "reverted",
    gasUsed: rpc.gasUsed.toString(),
    feePerGasBase: rpc.effectiveGasPrice.toString(),
  });
}

async function finalBlock(
  options: EvmReceiptReaderOptions,
  latest: bigint,
  signal: AbortSignal,
): Promise<bigint> {
  const { finality, rpc } = options;
  if (finality.kind === "confirmations") {
    const final = latest - BigInt(finality.blocks);
    return final > 0n ? final : 0n;
  }
  const block = await requestResult(rpc, {
    method: "eth_getBlockByNumber",
    params: ["finalized", false],
    result: blockNumberSchema,
    signal,
  });
  return block.number < latest ? block.number : latest;
}

/**
 * Creates the `ReceiptReader` of one EVM chain over its RPC failover: `eth_getTransactionReceipt`,
 * `eth_blockNumber`, and the final block by the chain's rule: the `finalized` tag, or the latest
 * block less its confirmations. A hash no block holds reads as no receipt. A chain it does not
 * read is a fault.
 */
export function createEvmReceiptReader(options: EvmReceiptReaderOptions): ReceiptReader {
  const { rpc, chain } = options;
  return {
    async receipt(asked, hash, { signal }) {
      signal.throwIfAborted();
      served(chain, asked);
      const found = await requestResult(rpc, {
        method: "eth_getTransactionReceipt",
        params: [hash],
        result: receiptResultSchema,
        signal,
      });
      return found === null ? undefined : receiptOf(found);
    },
    async head(asked, { signal }): Promise<ChainHead> {
      signal.throwIfAborted();
      served(chain, asked);
      const latest = await requestResult(rpc, {
        method: "eth_blockNumber",
        params: [],
        result: quantitySchema,
        signal,
      });
      return { latest, final: await finalBlock(options, latest, signal) };
    },
  };
}
