# @binference/flap

## Purpose

The `flap` launchpad. It trades the tokens still on Flap's bonding curves through Flap's Portal,
the contract the registry lists for it, and tells the engine which tokens those are, so a buy or a
sell of a curve token goes to Flap and nowhere else.

- **Curve read.** `getTokenV8Safe(token)` on the Portal. A token tradable on its curve, or in any
  state but graduated, is Flap's, with the asset its curve trades against. A graduated token, and
  one the Portal answers `TokenNotFound` for, is off its curve.
- **Quote.** The token's state first, then `quoteExactInput` by `eth_call`. Only a token tradable on
  its curve, against BNB, USDT or USD1, with that asset. The quote names the Portal's tax on that
  side; its price impact is measured at the curve's price before the trade, less that tax.
- **Build.** One `swapExactInput` call to the Portal with the exact input and the host's minimum
  out. BNB travels as the call's value; a token input first gets an exact approval of the Portal.
- **Decode.** The Portal pays the caller, so the recipient is the draft's sender. The call carries
  no deadline, and the venue declares so on each chain.
- **Price read.** For the price watcher, one `getTokenV8Safe(token)` read of the Portal each block:
  its `price` is the curve's price in base units of the quote asset for one whole token. Only a
  token tradable on its curve gets a read; once it leaves its curve, or trades against another
  asset, its answers say `replan`, so the watcher finds another read.

## API

| Export                     | What it does                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| `createFlapVenue`          | The `flap` launchpad over each chain's RPC failover                  |
| `flapDeclaration`          | What the venue declares on given chains, without reading any         |
| `FlapOptions`              | The chains the venue trades on                                       |
| `FlapChain`                | One chain: its id, its coin, its quote tokens and its RPC failover   |
| `@binference/flap/testing` | The Portal's recorded answers, a scripted Portal and a venue over it |

## Example

The composition root builds the venue from the registry's chain and the chain's RPC failover:

```ts
import { createFlapVenue } from "@binference/flap";

const flap = createFlapVenue({
  chains: [{ chain: bsc.ref, nativeAsset: bsc.nativeAsset, quoteTokens: [usdt, usd1], rpc }],
});
const host = createVenueHost({ venues: [flap], chains, clock, callTimeoutMs: 5_000 });
```
