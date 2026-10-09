# @binference/okx

## Purpose

The `okx` venue: binference's second quote and fallback, on the owner's OKX key. It quotes on
OKX's DEX aggregator API (version 6) and trades through OKX's DEX router, the router the registry
lists for it. KyberSwap stays the keyless primary route.

- **Sign.** Every call is a GET with the owner's key, passphrase, an ISO timestamp and the Base64
  HMAC-SHA256 of the timestamp, the method and the path with its query, under the secret key.
- **Quote.** `GET /api/v6/dex/aggregator/quote` with the exact input. The answer must trade the
  asked tokens and amount. A route through PancakeSwap Infinity or Uniswap v4, whose hooks OKX's
  answer does not name, is dropped, and the venue asks once more without those protocols' DEX ids
  from `get-liquidity`; a second such route is no route.
- **Build.** `GET /api/v6/dex/aggregator/swap` for the wallet, with the quote's excluded DEX ids
  and the host's slippage. The call must go to the registry's router. Where OKX's minimum is lower
  or its deadline later than the host's, the venue rewrites them in the calldata: the router checks
  both itself after the route runs. A token input first gets an exact approval of OKX's
  TokenApprove.
- **Decode.** The router's `dagSwapTo` and `dagSwapByOrderId`, with the recipient, the exact input,
  the minimum return and the deadline read from the call. Commission and trim terms, extra bytes,
  and the router's own-balance and Permit2 modes are refused.
- **Errors.** Too little liquidity, an unsupported token, an amount out of range and a price impact
  past OKX's protection are no route. A rate limit, a service fault and a timestamp OKX read late
  are retryable faults; a refused key or request is not. Each fault names OKX's code.

## API

| Export                    | What it does                                                      |
| ------------------------- | ----------------------------------------------------------------- |
| `createOkxVenue`          | The `okx` venue over an `Http` port, for the chains it is given   |
| `okxDeclaration`          | The venue's id and contracts on its chains, without a key         |
| `OkxOptions`              | The `Http` port, the clock, the owner's key and the chains        |
| `OkxKeys`                 | The key, its secret and the passphrase, each a `Secret`           |
| `OkxChain`                | One chain: its id and its coin                                    |
| `@binference/okx/testing` | Answers in the shape of OKX's API reference and a venue over them |

## Example

The composition root builds the venue only when the config names the owner's OKX key:

```ts
import { createOkxVenue } from "@binference/okx";

const okx = createOkxVenue({
  http,
  clock,
  keys: { apiKey, secretKey, passphrase },
  chains: [{ chain: bscChain.ref, nativeAsset: bscChain.nativeAsset }],
});
const host = createVenueHost({ venues: [kyberswap, okx], chains, clock, callTimeoutMs: 5_000 });
```
