# @binference/across

## Purpose

The `across` bridge: moves USDC, USDT and ETH from BNB Smart Chain to a saved address on Ethereum,
Base, Arbitrum One or Robinhood Chain through Across, keyless.

- **Quote.** `GET /swap/approval` on Across's Swap API with the exact input, the wallet as
  depositor and refund address, and the recipient. The answer must be a direct bridge of the asked
  tokens and amount, through the registry's SpokePool, to the recipient, with an empty message, its
  output equal to its least and expected output and to the input less its fees, and its timing
  inside Across's ranges. Its output is the least a fill pays; its fees are Across's LP, relayer
  and gas parts. A wrapped-coin route names the coin a fill pays a wallet.
- **Build.** An exact approval of the SpokePool, then `depositV3` with Across's terms from the
  quote, no further request. A quote given for another request is refused.
- **Decode.** `depositV3` in that exact form: the depositor, the recipient on the destination
  chain, the exact input, the delivered token with its least output, and the fill deadline.
- **Status.** `GET /deposit/status` by the deposit's transaction: unseen, pending, filled with the
  fill's transaction, expired, or refunded with the refund's transaction.
- **Errors.** An amount under or over the route's limits or over its liquidity names its reason; a
  route Across does not enable or serves now only with a swap on either side, and an invalid token
  or chain, are no route. A refused request, a rate limit and a fault upstream are
  faults that name Across's code; the last two are retryable.

## API

| Export                       | What it does                                                     |
| ---------------------------- | ---------------------------------------------------------------- |
| `createAcrossBridge`         | The `across` bridge over an `Http` port, for the routes given    |
| `acrossDeclaration`          | The bridge's id and contracts on its chains, without an API      |
| `acrossId`                   | `across`, the id the registry names its contracts after          |
| `AcrossOptions`              | The `Http` port, the source chains and the routes                |
| `AcrossRoute`                | One route: its tokens, their decimals and a wrapped route's coin |
| `@binference/across/testing` | Answers recorded from Across's API and a bridge over them        |

## Example

```ts
import { createAcrossBridge } from "@binference/across";

const across = createAcrossBridge({
  http,
  chains: [bscChain.ref],
  routes: [{ leaves: bscUsdc, arrives: baseUsdc }],
});
const quote = await across.quote(request, { signal });
```
