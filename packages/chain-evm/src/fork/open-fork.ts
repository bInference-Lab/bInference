import { bsc } from "@binference/chains";
import { createManualClock } from "@binference/core/testing";
import { type Address, type Hex, type PublicClient, type TransactionReceipt, toHex } from "viem";
import { z } from "zod";
import { type EvmChain, evmChainOf } from "../evm-chain.js";
import { createEvmClient } from "../rpc/create-evm-client.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { addressSchema, hexSchema } from "../rpc/evm-wire.schema.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { createLoopbackHttp } from "../testing/loopback-http.js";
import { callLoopback } from "./call-loopback.js";
import type { ForkContext } from "./fork-context.js";

/** A transaction a fork test sends from an unlocked or impersonated account. */
interface ForkTransaction {
  readonly from: Address;
  readonly to: Address;
  readonly value?: bigint;
  readonly data?: Hex;
}

/** The suite's BSC fork, as one test sees it. */
export interface Fork {
  /** BSC, as chain-evm reads it. */
  readonly chain: EvmChain;
  /** The block the fork was taken at. */
  readonly block: bigint;
  /** anvil's first default account. anvil holds its key, so `send` signs nothing. */
  readonly account: Address;
  /** Reads the fork through the RPC failover, as production code reads a chain. */
  readonly rpc: RpcFailover;
  /** A viem client over {@link Fork.rpc}. */
  readonly client: PublicClient;
  /** Calls one of anvil's own methods, such as `anvil_setBalance`, on the fork. */
  call(method: string, params: readonly JsonValue[]): Promise<JsonValue>;
  /**
   * Sends a transaction, mines a block for it and waits for its receipt. anvil answers a send
   * before it mines it, so the hash alone proves nothing.
   */
  send(transaction: ForkTransaction): Promise<TransactionReceipt>;
}

const http = createLoopbackHttp();
const accountsSchema = z.tuple([addressSchema], addressSchema);
const receiptTimeoutMs = 30_000;
// anvil's own estimate runs at the fork block's second, but it mines the next block at the wall
// clock. A PancakeSwap v2 pair updates its price accumulators only when the second changes, so an
// estimated swap ran out of gas in about half the runs. A fixed limit above any swap's avoids it.
const gasLimit = 5_000_000n;

// anvil is on loopback, so the test's own timeout bounds a call and the failover's clock never
// needs to move.
function failoverTo(name: string, url: string): RpcFailover {
  return createRpcFailover({
    endpoints: [{ name, url }],
    http,
    clock: createManualClock(),
    timeoutMs: 60_000,
    restMs: 1,
  });
}

async function sendAndMine(
  fork: Pick<Fork, "call" | "client">,
  transaction: ForkTransaction,
): Promise<TransactionReceipt> {
  const { from, to, value = 0n, data = "0x" } = transaction;
  const sent = await fork.call("eth_sendTransaction", [
    { from, to, value: toHex(value), data, gas: toHex(gasLimit) },
  ]);
  // The fork mines only on demand, so the test decides which transactions share a block.
  await fork.call("evm_mine", []);
  return fork.client.waitForTransactionReceipt({
    hash: hexSchema.parse(sent),
    pollingInterval: 50,
    timeout: receiptTimeoutMs,
  });
}

/**
 * Opens the suite's fork for one test. Every request stops when `signal` aborts. The fork is
 * shared, so a test opens it through `withFork`, which reverts the test's changes.
 */
export async function openFork(context: ForkContext, signal: AbortSignal): Promise<Fork> {
  const chain = evmChainOf(bsc);
  const rpc = failoverTo("anvil-fork", context.rpcUrl);
  const client = createEvmClient({ chain, rpc, signal });
  const block = BigInt(context.block);
  const call = async (method: string, params: readonly JsonValue[]): Promise<JsonValue> =>
    callLoopback({ rpcUrl: context.rpcUrl, method, params }, signal);
  const [account] = accountsSchema.parse(await call("eth_accounts", []));
  return {
    chain,
    block,
    account,
    rpc,
    client,
    call,
    send: async (transaction) => sendAndMine({ call, client }, transaction),
  };
}
