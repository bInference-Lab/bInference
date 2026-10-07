# @binference/chains

## Purpose

The registry's data: each chain binference may use, with its tokens, the contracts its venues
call, its public RPCs, private relays and block explorers. Every address was read on chain before
it entered, and carries the source that names it and the day it was read.

## API

| Export                | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `bsc`                 | BNB Smart Chain mainnet as a `ChainDefinition`                      |
| `bscPriceFeeds`       | BSC's 8-decimal Chainlink USD feeds, each with its heartbeat        |
| `PriceFeedDefinition` | A feed: its contract, asset, decimals, heartbeat, a stablecoin mark |

## Example

```ts
import { createChainRegistry } from "@binference/chain";
import { bsc } from "@binference/chains";

const registry = createChainRegistry({ chains: [bsc], families, signingSchemes });
```
