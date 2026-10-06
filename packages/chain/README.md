# @binference/chain

## Purpose

The model every chain shares. Chains, accounts and assets are CAIP ids; an `Amount` is an asset
and its base units; a chain family turns addresses into their canonical form and checks
signatures; the registry holds the chains binference may use. Nothing here names a chain.

## API

| Export                                                                | What it does                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ChainRef`, `parseChainRef`, `printChainRef`, `chainRefParts`         | CAIP-2 chain ids                                                 |
| `AccountRef`, `parseAccountRef`, `printAccountRef`, `accountRefParts` | CAIP-10 account ids                                              |
| `AssetRef`, `parseAssetRef`, `printAssetRef`, `assetRefParts`         | CAIP-19 asset types                                              |
| `chainRefSchema`, `accountRefSchema`, `assetRefSchema`                | The same ids parsed at a boundary                                |
| `Amount`, `amountSchema`                                              | An asset and its base units, as JSON carries them                |
| `ChainFamily`, `SigningScheme`, `ChainRegistry`                       | The ports a family package and the composition root fill         |
| `ChainDefinition`, `chainDefinitionSchema`                            | One chain as data: tokens, contracts, RPCs, relays and explorers |
| `createChainRegistry`                                                 | The registry, which refuses data its family does not accept      |
| `UnsignedTx`, `SignedTx`, `TxHash`                                    | Transactions as the core passes them, opaque inside              |
| `@binference/chain/testing`                                           | Contract suites for each port, a fake family and a fake chain    |

## Example

```ts
import { assetRefParts, parseAssetRef } from "@binference/chain";

const parsed = parseAssetRef(text);
if (!parsed.ok) {
  return parsed;
}
const { chain, assetReference } = assetRefParts(parsed.value);
```
