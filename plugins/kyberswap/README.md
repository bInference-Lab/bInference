# @binference/kyberswap

## Purpose

The `kyberswap` venue, binference's primary keyless route. It quotes on KyberSwap's public
aggregator API with binference's client id and builds each trade through KyberSwap's
MetaAggregationRouterV2, the router the registry lists for it.

- **Quote.** `GET /{chain}/api/v1/routes` with the exact input. The answer must trade the asked
  tokens and amount through the registry's router, with no fee. A route through a pool whose hook
  is off the chain's allowlist is dropped, and the venue asks once more without those pools' DEX
  ids; a second route through an unlisted hook is no route.
- **Build.** `POST /{chain}/api/v1/route/build` with the quoted route, the agent's wallet as sender
  and recipient, and the host's deadline. The call must go to the registry's router and hand the
  input to the registry's AggregationExecutorProxy. When the API's minimum return is below the
  host's, the venue raises it in the calldata: the router reads it outside the payload KyberSwap
  signs. A token input gets an exact approval of the router first.
- **Decode.** The router reverts unless the recipient gained the minimum return. The executor
  reverts with `QuoteExpired()` after the deadline in its signed payload; the venue reads that
  deadline, and refuses any call with a fee, a permit or one of the router's own flags.

## API

| Export                          | What it does                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `createKyberswapVenue`          | The `kyberswap` venue over an `Http` port, for the chains it is given |
| `KyberswapOptions`              | The `Http` port, the client id and the chains                         |
| `KyberswapChain`                | One chain: its id, its coin and the pool hooks routes may pass        |
| `@binference/kyberswap/testing` | Recorded API answers and a venue over them, for tests                 |

## Example

The composition root builds the venue from the registry's chain and the config's client id:

```ts
import { createKyberswapVenue } from "@binference/kyberswap";

const kyberswap = createKyberswapVenue({
  http,
  clientId: config.venues.kyberClientId,
  chains: [{ chain: bscChain.ref, nativeAsset: bscChain.nativeAsset, allowedHooks: [] }],
});
const host = createVenueHost({ venues: [kyberswap], chains, clock, callTimeoutMs: 5_000 });
```
