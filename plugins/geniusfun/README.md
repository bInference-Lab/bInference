# @binference/geniusfun

## Purpose

The `geniusfun` launchpad. It trades the tokens still on Genius.fun's bonding curves, each on the
curve its launch made, and tells the engine which tokens those are, so a buy or a sell of a curve
token goes to its curve and nowhere else.

No agent wallet's ceiling can list a launch's own curve, so only a paper agent may add this venue
until live curve trades get a launch wallet of their own (decision 0212); `binference init` does
not add it.

- **Stacks.** Genius.fun runs several stacks at once, each with a factory the registry lists by
  name (`factory-m4-2`, `factory-m4-1`). A token's launch is the record one of them keeps of it
  (`getLaunchedToken`), its curve among it.
- **Curve read.** A token on its launch's curve, not graduated and still selling tokens, is held
  against what its curve trades it for, and names that curve as the launch's own contract. A token
  whose curve is ready to graduate, or swept, is held with no contract until its pool exists, so
  it trades nowhere. A token with its pool, rescued, or never launched is off its curve, so the
  pools take over.
- **Quote.** The curve's reserves, fee and sellable tokens, the launch's creator tax, and the snipe
  tax the wallet would pay now (`currentSnipeTaxBps`), priced as the curve's verified code prices
  them, to the wei. Only against BNB, USDT or USDC. The quote names the taxes, and the snipe tax
  apart, so the risk step refuses a buy in the launch window above the agent's maximum tax.
- **Build.** One `buy` or `sell` call to the curve, paying the wallet, with the host's minimum
  out and no deadline; a token input first gets an exact approval of the curve.
- **Decode.** The call's input, minimum out and recipient from its bytes, and its assets from the
  launch the venue read for the curve.
- **Price read.** For the price watcher, the curve's `getReserves()` and `sellableTokens()` each
  block.
- **Insiders.** The wallets a launch exempted from its snipe tax, from the receipts of its launch
  second.

## API

| Export                          | What it does                                                      |
| ------------------------------- | ----------------------------------------------------------------- |
| `createGeniusfunVenue`          | The `geniusfun` launchpad over each chain's RPC failover          |
| `geniusfunDeclaration`          | What the venue declares on given chains, without reading any      |
| `GeniusfunOptions`              | The chains the venue trades on, each a `CurveChain`               |
| `@binference/geniusfun/testing` | Answers recorded on BSC, a failover over them and a venue over it |

## Example

The composition root builds the venue from the registry's chain and the chain's RPC failover:

```ts
import { createGeniusfunVenue } from "@binference/geniusfun";

const geniusfun = createGeniusfunVenue({
  chains: [{ chain: bsc.ref, nativeAsset: bsc.nativeAsset, quoteTokens: [usdt, usdc], rpc }],
});
const host = createVenueHost({ venues: [geniusfun], chains, clock, callTimeoutMs: 5_000 });
```
