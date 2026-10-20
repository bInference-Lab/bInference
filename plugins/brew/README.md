# @binference/brew

## Purpose

The `brew` venue. Brew launches a token by placing its whole fixed supply into a PancakeSwap V3
pool, locked for good, so its tokens trade through the aggregators from the first block and the
venue trades nothing itself (decision 0278).

- **Registry.** Only the single-pair BrewFactory counts as Brew's, listed as `factory`. A token is
  Brew's only when that factory recorded its launch (`launches(token)`); a token from any other
  contract is unknown.
- **Launch reading.** For the launch feed, the factory's `TokenLaunched` logs, with the token's
  creator, words and pair, and the first buy's recipient as an insider.
- **Launches.** Given its launch options, a token from the launch wallet through BrewFactory's
  `launch`: a 1% pool with the whole supply in one range from the starting price, the first buy
  in the same call at the host's minimum, the card's words and the owner's small picture in the
  metadata address, the owner's fee recipient or holder rewards, and an address ending in 6666
  (decision 0283).

## API

| Export                     | What it does                                                                      |
| -------------------------- | --------------------------------------------------------------------------------- |
| `createBrewVenue`          | The `brew` venue on the chains given                                              |
| `brewDeclaration`          | What the venue declares on given chains, without reading any                      |
| `BrewOptions`, `BrewChain` | The chains the venue serves, with each chain's wrapped coin, and its `launches`   |
| `BrewLaunchOptions`        | What launches need: the salts' randomness and each chain it launches on           |
| `BrewLaunchChain`          | One chain it launches on: its RPC failover, its simulator and its pairs           |
| `BrewPair`                 | An asset a token may launch against, with its decimals and its fixed start if any |
| `@binference/brew/testing` | Launch logs recorded on BSC, a fake factory chain and a launcher over it          |

## Example

```ts
import { createBrewVenue } from "@binference/brew";

const brew = createBrewVenue({
  chains: [{ chain: bsc.ref, nativeAsset: bsc.nativeAsset, wrappedNative: wbnb }],
  // Without `launches`, the venue reads launches and makes none.
  launches: {
    random,
    chains: [{ chain: bsc.ref, rpc, simulator, pairs: [{ asset: bnb, decimals: 18, startBase }] }],
  },
});
const host = createVenueHost({ venues: [brew], chains, clock, callTimeoutMs: 5_000 });
```
