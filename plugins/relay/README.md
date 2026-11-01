# @binference/relay

## Purpose

The `relay` bridge: moves USDC and USDT from BNB Smart Chain to a saved address on Ethereum, Base,
Arbitrum One, Robinhood Chain (as USDG, by a swap) or Solana through Relay, from the agent's
bridge wallet.

- **Quote.** `POST /quote/v2` with the exact input, the wallet as user and refund address, the
  recipient, no slippage, the order data and a time to live of an hour, asked once more after a
  pause when Relay names a passing fault. Relay's solver must have signed the order's id; the
  order must be the one its id names, worked out from its data, pay exactly the input, pay the
  recipient the asked token on the asked chain, refund only the wallet or the recipient, and be
  named by a deposit to the registry's depository. Its least output is the least a fill pays and
  exactly the input less Relay's solver fees, in the token that leaves; on a route the registry
  marks as a swap, it may miss that by at most the route's cap. A quote holds 55 minutes.
- **Build.** An exact approval of the depository, then `depositErc20` naming the quote's order, no
  further request. A quote given for another request is refused.
- **Decode.** `depositErc20` in that exact form, as an order deposit: the depositor, the exact
  input and the order id.
- **Status.** Relay's requests by the deposit's transaction: unseen, pending, filled with the
  fill's transaction, refunded with the refund's transaction, or expired once Relay says no
  refund follows a failed fill. Version 2 without a key, until Relay retires it on 2026-11-24;
  version 3 with a key. `pageOf` gives Relay's page for a deposit without asking Relay.
- **Settlement.** The depository's deposit event names the order; a Solana fill's memo must name
  it; an EVM fill counts what Relay's solver sent by the token's transfer events, never more than
  the least output, and a refund the same, never more than the deposit.
- **Errors.** An amount under or over the route's limits or its solvers' liquidity names its
  reason; a chain, token or route Relay does not serve is no route. A refused request, a missing
  key, a rate limit and a fault at Relay are faults that name Relay's code; the last two are
  retryable.

## API

| Export                      | What it does                                                   |
| --------------------------- | -------------------------------------------------------------- |
| `createRelayBridge`         | The `relay` bridge over an `Http` port, for the routes given   |
| `createRelayVenue`          | Relay's declaration as a venue that trades nothing             |
| `relayDeclaration`          | The bridge's id and contracts on its chains, without an API    |
| `relayId`                   | `relay`, the id the registry names its contracts after         |
| `RelayOptions`              | The `Http` port, the clock, the key, the chains and the routes |
| `RelayRoute`                | One route: its tokens and their decimals                       |
| `@binference/relay/testing` | Answers recorded from Relay's API and a bridge over them       |

## Example

```ts
import { createRelayBridge } from "@binference/relay";

const relay = createRelayBridge({
  http,
  clock,
  chains: [bscChain.ref],
  routes: [{ leaves: bscUsdc, arrives: solanaUsdc, decimals: { leaves: 18, arrives: 6 } }],
  depositories: { [bscChain.ref]: depository },
});
const quote = await relay.quote(request, { signal });
```
