import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { quantitySchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";

/** The EIP-1559 fees per gas of a transaction, in wei. */
export interface EvmFees {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

/** What {@link readFees} needs. */
export interface FeeOptions {
  /**
   * The most wei per gas the caller pays. The fees come from an RPC node, which nothing else
   * checks, so a suggestion above this cap is refused instead of paid.
   */
  readonly maxFeePerGasCap: bigint;
  readonly signal: AbortSignal;
}

const latestBlockSchema = z.looseObject({ baseFeePerGas: quantitySchema });

/**
 * Reads the fees for the next transaction: the node's suggested priority fee, which on BNB Smart
 * Chain is the network floor, and a fee cap of twice the latest base fee plus that priority fee,
 * which covers the base fee's growth for several blocks. A chain without a base fee is refused by
 * the block's schema. Fees above the cap are an expected failure.
 */
export async function readFees(
  rpc: RpcFailover,
  options: FeeOptions,
): Promise<Result<EvmFees, "fee_above_cap">> {
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
  return maxFeePerGas > options.maxFeePerGasCap
    ? err("fee_above_cap")
    : ok({ maxFeePerGas, maxPriorityFeePerGas });
}
