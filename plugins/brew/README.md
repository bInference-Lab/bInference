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

## API

| Export                     | What it does                                                 |
| -------------------------- | ------------------------------------------------------------ |
| `createBrewVenue`          | The `brew` venue on the chains given                         |
| `brewDeclaration`          | What the venue declares on given chains, without reading any |
| `BrewOptions`, `BrewChain` | The chains the venue serves, with each chain's wrapped coin  |
| `@binference/brew/testing` | Launch logs recorded on BSC                                  |

## Example

```ts
import { createBrewVenue } from "@binference/brew";

const brew = createBrewVenue({
  chains: [{ chain: bsc.ref, nativeAsset: bsc.nativeAsset, wrappedNative: wbnb }],
});
const host = createVenueHost({ venues: [brew], chains, clock, callTimeoutMs: 5_000 });
```
