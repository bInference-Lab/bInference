# 0316. Only Relay delivers dollars as USDG on Robinhood Chain

Status: Accepted

Accepted by the owner on 2026-11-01.

Amends [decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md).

## Context

[Decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md)
records, in its context, that Across delivers USDC on Robinhood Chain as USDG. Across's own API says
otherwise:

- Its `available-routes` endpoint lists from BNB Smart Chain to Robinhood Chain only ETH to WETH, on
  2026-10-29 and again on 2026-11-01.
- Its Swap API reaches USDG from BSC USDC only as `anyToAny`: a swap into ETH on BSC through its
  periphery, the ETH bridge, and a swap of the WETH into USDG on arrival (recorded 2026-11-01: 20
  USDC quoted at 19.92 USDG expected, 19.78 at least).
- [Decision 0301](0301-a-bridge-route-moves-a-dollar-to-a-dollar-or-eth-to-eth-as-the-bridge-s-api-lists-it.md)
  lists no route with a swap on either side, and names Relay's one-fill USDC and USDT to USDG as the
  only dollar routes to Robinhood Chain.

## Decision

- On Robinhood Chain, USDC and USDT from BSC arrive as USDG only through Relay, in one fill, from a
  bridge wallet ([decision 0307](0307-a-bridge-wallet-holds-only-its-own-deposits-and-runs-every-route-only-it-may-pay.md)).
- Across serves Robinhood Chain only ETH to WETH, which an account with no code receives as ETH.
- Decision 0297 stands in every other part: the delivered token may differ from the token sent, and
  the card and the delivery read follow the route's delivered token.

## Consequences

- An owner with no bridge wallet can move only ETH to Robinhood Chain.
- The registry's routes (`bscBridgeRoutes`) already list this; no code changes.
- The examples in the glossary and spec 4 that show USDC arriving as USDG stay true of Relay's
  route.

## Alternatives

- **Leave 0297's line as written.** A reader would expect Across to serve USDG, which neither its
  routes nor the registry offer. Rejected.
- **List Across's two-swap path to USDG.** Two DEX swaps around the bridge, each with its own
  slippage, for a route Relay fills in one step; decision 0301 already left it out. Rejected.
