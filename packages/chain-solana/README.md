# @binference/chain-solana

## Purpose

The Solana chain family, read only. binference never signs on Solana: a bridge from BSC delivers
there, and this package reads what arrived. It holds the base58 codec for 32-byte Solana addresses,
the transport Solana's SDK sends its RPC calls through over the core `Http` port, and the
`DeliveryReader` of a Solana cluster.

## API

| Export                                                                 | What it does                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `parseSolanaAddress`, `solanaAddressToBytes`, `solanaAddressFromBytes` | Base58 text that decodes to exactly 32 bytes, and back                                                         |
| `solanaChainOf`, `solanaAddressOn`, `solanaMintOn`                     | A chain definition's Solana view, and an account's address or an asset's mint on it                            |
| `createSolanaTransport`, `createSolanaRpcClient`                       | The SDK's RPC transport over the `Http` port, endpoint by endpoint, and the client on it; integers as `bigint` |
| `createSolanaDeliveryReader`                                           | The `DeliveryReader` port: SOL and token balances, what one transaction brought an account                     |
| `readSolanaMint`                                                       | A token's mint account: its program, decimals, supply and authorities                                          |
| `solanaFamilyId`, `solanaNamespace`, `solanaTokenNamespace`            | The family id, the CAIP-2 namespace and the CAIP-19 token namespace                                            |

## Example

```ts
import {
  createSolanaDeliveryReader,
  createSolanaRpcClient,
  solanaChainOf,
} from "@binference/chain-solana";

const rpc = createSolanaRpcClient({ endpoints, http, clock, timeoutMs: 10_000 });
const reader = createSolanaDeliveryReader({ rpc, chain: solanaChainOf(solana) });
const delivery = await reader.delivery({ hash, recipient, asset }, { signal });
```
