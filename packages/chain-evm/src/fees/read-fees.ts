import { z } from "zod";
import { quantitySchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";

/** The EIP-1559 fees per gas of a transaction, in wei. */
export interface EvmFees {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

/** The fees {@link readFees} read, and whether they pass the caller's cap. */
export interface FeeReading {
  readonly fees: EvmFees;
  /**
   * The fee cap per gas is above the caller's cap. The fees stand, but only the owner's tap may pay
   * them: an intent built with them opens a card (decision 0102).
   */
  readonly isAboveCap: boolean;
}

/** What {@link readFees} needs. */
export interface FeeOptions {
  /**
   * The chain's network fee cap, in wei per gas. The fees come from an RPC node, which nothing
   * else checks, so the reading says whether they pass this cap.
   */
  readonly maxFeePerGasCap: bigint;
  readonly signal: AbortSignal;
}

const latestBlockSchema = z.looseObject({ baseFeePerGas: quantitySchema });

/**
 * Reads the fees for the next transaction: the node's suggested priority fee, which on BNB Smart
 * Chain is the network floor, and a fee cap of twice the latest base fee plus that priority fee,
 * which covers the base fee's growth for several blocks. A chain without a base fee is refused by
 * the block's schema. Fees above the caller's cap come back marked, never refused, so the caller
 * can ask the owner.
 */
export async function readFees(rpc: RpcFailover, options: FeeOptions): Promise<FeeReading> {
  const { signal } = options;
  const [maxPriorityFeePerGas, latest] = await Promise.all([
    requestResult(rpc, {
      method: "eth_maxPriorityFeePerGas",
      params: [],
      result: quantitySchema,
      signal,
    }),
    requestResult(rpc, {
      method: "eth_getBlockByNumber",
      params: ["latest", false],
      result: latestBlockSchema,
      signal,
    }),
  ]);
  const maxFeePerGas = latest.baseFeePerGas * 2n + maxPriorityFeePerGas;
  return {
    fees: { maxFeePerGas, maxPriorityFeePerGas },
    isAboveCap: maxFeePerGas > options.maxFeePerGasCap,
  };
}
