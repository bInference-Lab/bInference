import type { ChainDefinition, DeliveryReader } from "@binference/chain";
import {
  createEvmDeliveryReader,
  createEvmReceiptReader,
  createRpcFailover,
  evmChainOf,
  parseEvmAddress,
} from "@binference/chain-evm";
import {
  createSolanaDeliveryReader,
  createSolanaRpcClient,
  solanaChainOf,
  solanaFamilyId,
} from "@binference/chain-solana";
import type { Clock, Http } from "@binference/core";

// A node answers a delivery read within this; past it, the next endpoint is asked.
const readTimeoutMs = 10_000;
// An EVM endpoint that failed a read rests this long before it is asked again.
const restMs = 30_000;

/**
 * The delivery reader of one chain a bridge reads (decision 0297), over the registry's keyless
 * endpoints with failover: Solana's over its JSON-RPC, an EVM chain's over its receipts and its
 * Multicall3, which reads a token balance. An EVM chain whose registry lists no Multicall3 has none.
 */
export function deliveryReaderOf(
  definition: ChainDefinition,
  parts: { readonly http: Http; readonly clock: Clock },
): DeliveryReader | undefined {
  const endpoints = definition.rpcs.map(({ name, url }) => ({ name, url }));
  const { http, clock } = parts;
  if (definition.family === solanaFamilyId) {
    const rpc = createSolanaRpcClient({ endpoints, http, clock, timeoutMs: readTimeoutMs });
    return createSolanaDeliveryReader({ rpc, chain: solanaChainOf(definition) });
  }
  const entry = definition.contracts.find(({ venue }) => venue === "multicall3");
  const multicall = entry === undefined ? undefined : parseEvmAddress(entry.address);
  if (multicall?.ok !== true) {
    return undefined;
  }
  const rpc = createRpcFailover({ endpoints, http, clock, timeoutMs: readTimeoutMs, restMs });
  const chain = evmChainOf(definition);
  const receipts = createEvmReceiptReader({ rpc, chain, finality: definition.finality });
  return createEvmDeliveryReader({ rpc, chain, receipts, multicall: multicall.value });
}
