import type { ChainRef } from "@binference/chain";
import { quantitySchema } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import type { ChainReads } from "./chain-reads.js";
import type { ReadHead } from "./pause-fence.js";

// A head read gives up past this, and is asked again.
const headTimeoutMs = 5_000;

/**
 * Reads a chain's newest block number through its RPC failover, within 5 seconds, as the price
 * hand-off asks after a pause of the engine (decision 0268). A chain with no reads, or no node
 * that answers, rejects with a `BinferenceError`.
 */
export function chainHeadReader(reads: ReadonlyMap<ChainRef, ChainReads>): ReadHead {
  return async (chain, signal) => {
    const rpc = reads.get(chain)?.rpc;
    const reply = await rpc?.request({
      method: "eth_blockNumber",
      params: [],
      result: quantitySchema,
      signal,
      timeoutMs: headTimeoutMs,
    });
    if (reply?.kind !== "result") {
      throw new BinferenceError({
        code: "chain.rpc_down",
        message: `No node of ${chain} answered its newest block.`,
        details: { chain },
      });
    }
    return reply.value;
  };
}
