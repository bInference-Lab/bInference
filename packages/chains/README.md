# @binference/chains

## Purpose

The registry's data: each chain binference may use, with its tokens, the contracts its venues
call, its public RPCs, private relays and block explorers. Every address was read on chain before
it entered, and carries the source that names it and the day it was read. The chains bridges from
BSC deliver to are here too, read only: binference holds no wallet and signs nothing there, it
reads what arrived. `pnpm chains:read` reads them back on each chain, live.

## API

| Export                                                       | What it does                                                                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `bsc`                                                        | BNB Smart Chain mainnet as a `ChainDefinition`                                                                                                 |
| `bscPriceFeeds`                                              | BSC's 8-decimal Chainlink USD feeds, each with its heartbeat                                                                                   |
| `bscRatePrices`                                              | BSC's tokens priced at BNB's price times their own contract's rate: slisBNB through Lista's stake manager, 1 to 1.2 BNB, within 1% of its feed |
| `ethereum`, `baseMainnet`, `arbitrum`, `robinhood`, `solana` | The chains bridges from BSC deliver to: their stablecoins, WETH, public RPCs and explorers                                                     |
| `bscBridgeRoutes`                                            | The routes Across and Relay serve from BSC, read from each bridge's API: the token that leaves, the chain and the token that arrives           |
| `PriceFeedDefinition`                                        | A feed: its contract, asset, decimals, heartbeat, a stablecoin mark and wrappers                                                               |
| `RatePriceDefinition`                                        | A rate price: its token, the contract and function that convert it to the coin, the rate's bounds and its Chainlink feed                       |

## Example

```ts
import { createChainRegistry } from "@binference/chain";
import { bsc } from "@binference/chains";

const registry = createChainRegistry({ chains: [bsc], families, signingSchemes });
```
