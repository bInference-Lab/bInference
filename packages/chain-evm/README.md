# @binference/chain-evm

## Purpose

The EVM chain family. It reads a chain through its RPC endpoints with failover, prices gas,
simulates calls with `eth_simulateV1` and reads the transfers they make, decodes calldata, and
builds, hashes and checks the transactions a signer signs. It reads a venue's transaction draft
for the chain-neutral core: the contract it calls, the wei it sends, and the ERC-20 approval it
grants. Chain facts come in as data from
`@binference/chains`; nothing here names a chain.

## API

| Export                                                                   | What it does                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `createEvmFamily`, `parseEvmAddress`                                     | The `ChainFamily` port: `eip155` chains, addresses in EIP-55 form, draft reading  |
| `encodeEvmDraft`, `decodeEvmDraft`                                       | A venue's call as a `TxDraft`: the address called, the value and the calldata     |
| `evmChainOf`, `evmAccountRef`, `erc20AssetRef`                           | A chain definition's EVM view, and CAIP-10 and CAIP-19 ids for its addresses      |
| `createRpcFailover`, `RpcFailover`, `RpcEndpoint`                        | JSON-RPC over the `Http` port, endpoint by endpoint within a timeout, with health |
| `createEvmClient`                                                        | A viem public client whose requests go through the failover                       |
| `readFees`, `EvmFees`, `FeeReading`                                      | EIP-1559 fees per gas from the node, marked when above the caller's cap           |
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

## Fork tests

`src/fork/` holds the fork tests and their harness. They run against an anvil fork of BSC, so
`pnpm check` leaves them out; the fork suite runs them, every night in CI and on demand:

```sh
pnpm test:fork
```

It needs Foundry's `anvil` on `PATH` (CI pins 1.7.1) and the network. The suite's global setup
forks BNB Chain's public node 20 blocks behind the head and gives every test the same pinned
block. Public nodes keep about 120 blocks of state and flake at the head.

A test runs inside `withFork`, which hands it the fork:

- `fork.account` is anvil's first default account with 10 BNB. Its EIP-7702 code is cleared
  first: on BSC every anvil default account carries code that forwards the BNB it receives.
- `fork.send` sends from an unlocked or impersonated account, mines a block and waits for the
  receipt. anvil answers a send before it mines it, so the hash alone proves nothing.
- `fork.scanLogs` reads history up to the fork block from 48 Club's public node, through a
  loopback endpoint that forwards reads only, since BNB Chain's nodes refuse `eth_getLogs`. Blocks
  mined on the fork come from anvil.
- Whatever the test changes on the fork is reverted when it ends, even when it fails.

```ts
it("keeps the BNB sent to the test account", async ({ signal }) =>
  withFork(signal, async (fork) => {
    const before = await fork.client.getBalance({ address: fork.account });
    const receipt = await fork.send({ from: sender, to: fork.account, value: 10n ** 18n });
    expect(receipt.status).toBe("success");
    await expect(fork.client.getBalance({ address: fork.account })).resolves.toBe(
      before + 10n ** 18n,
    );
  }));
```
