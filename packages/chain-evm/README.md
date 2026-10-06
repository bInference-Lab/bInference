# @binference/chain-evm

## Purpose

The EVM chain family. It reads a chain through its RPC endpoints with failover, prices gas,
simulates calls with `eth_simulateV1` and reads the transfers they make, decodes calldata, and
builds, hashes and checks the transactions a signer signs. Chain facts come in as data from
`@binference/chains`; nothing here names a chain.

## API

| Export                                                                   | What it does                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `createEvmFamily`, `parseEvmAddress`                                     | The `ChainFamily` port: `eip155` chains, addresses in EIP-55 form                 |
| `evmChainOf`, `evmAccountRef`, `erc20AssetRef`                           | A chain definition's EVM view, and CAIP-10 and CAIP-19 ids for its addresses      |
| `createRpcFailover`, `RpcFailover`, `RpcEndpoint`                        | JSON-RPC over the `Http` port, endpoint by endpoint within a timeout, with health |
| `createEvmClient`                                                        | A viem public client whose requests go through the failover                       |
| `readFees`, `EvmFees`                                                    | EIP-1559 fees per gas from the node, refused above the caller's cap               |
| `simulate`, `Simulation`, `AssetTransfer`, `AssetApproval`               | `eth_simulateV1` with transfer traces, read into CAIP ids and amounts             |
| `decodeCall`                                                             | Calldata against a venue's ABI, as a `Result`                                     |
| `createEvmSigningScheme`, `encodeEvmTransaction`, `decodeEvmTransaction` | The `SigningScheme` port: build, hash and verify type-2 transactions              |
| `quantitySchema`, `hexSchema`, `addressSchema`, `jsonValueSchema`        | The wire values every RPC answer is checked with                                  |

## Example

```ts
import { createRpcFailover, evmChainOf, simulate } from "@binference/chain-evm";

const chain = evmChainOf(definition);
const rpc = createRpcFailover({
  endpoints: definition.rpcs.map(({ name, url }) => ({ name, url })),
  http,
  clock,
  timeoutMs: 3_000,
  restMs: 30_000,
});
const { calls } = await simulate(rpc, { chain, calls: [swapCall], signal });
for (const transfer of calls[0]?.transfers ?? []) {
  console.log(transfer.from, transfer.to, transfer.amount);
}
```

## Fork test

`src/fork/` simulates a PancakeSwap v2 swap on a BSC fork and checks it against the same swap sent
on the fork. It needs Foundry's `anvil` and the network, so `pnpm check` skips it. Fork 20 blocks
behind the head, since public nodes keep little state and flake at the head:

```sh
anvil --fork-url https://bsc-dataseed1.bnbchain.org --fork-block-number <head minus 20> --port 8545
BINFERENCE_FORK_RPC=http://127.0.0.1:8545 pnpm vitest run packages/chain-evm/src/fork
```
