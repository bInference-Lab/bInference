# @binference/chain-evm

## Purpose

The EVM chain family. It reads a chain through its RPC endpoints, moving to the next endpoint when
one fails, and gives viem clients that ride on that failover. Chain facts come in as data from
`@binference/chains`; nothing here names a chain.

## API

| Export                                                            | What it does                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `createEvmFamily`, `parseEvmAddress`                              | The `ChainFamily` port: `eip155` chains, addresses in EIP-55 form                 |
| `evmChainOf`, `evmAccountRef`, `erc20AssetRef`                    | A chain definition's EVM view, and CAIP-10 and CAIP-19 ids for its addresses      |
| `createRpcFailover`, `RpcFailover`, `RpcEndpoint`                 | JSON-RPC over the `Http` port, endpoint by endpoint within a timeout, with health |
| `createEvmClient`                                                 | A viem public client whose requests go through the failover                       |
| `quantitySchema`, `hexSchema`, `addressSchema`, `jsonValueSchema` | The wire values every RPC answer is checked with                                  |

## Example

```ts
import { createEvmClient, createRpcFailover, evmChainOf } from "@binference/chain-evm";

const chain = evmChainOf(definition);
const rpc = createRpcFailover({
  endpoints: definition.rpcs.map(({ name, url }) => ({ name, url })),
  http,
  clock,
  timeoutMs: 3_000,
  restMs: 30_000,
});
const client = createEvmClient({ chain, rpc, signal });
const head = await client.getBlockNumber();
```
