# 0301. A bridge route moves a dollar to a dollar or ETH to ETH, as the bridge's API lists it

Status: Accepted

Accepted by the lead on 2026-10-31.

## Context

Bridges deliver from BSC to Ethereum, Base, Arbitrum One, Robinhood Chain and Solana (decisions
0067 and 0297), each only through a route whose deposit the ceiling binds. A route the registry
lists is one binference offers, so the list decides what the owner can do. Each bridge's API serves more than plain bridging:

- Across's `available-routes` endpoint lists direct routes. On 2026-10-29 it listed USDC, USDT and
  ETH from BSC to Ethereum, Base and Arbitrum One, and ETH alone to Robinhood Chain, none to
  Solana. Its Swap API also reaches Robinhood Chain's USDG from USDC, as a swap into ETH on BSC,
  the ETH bridge, and a swap into USDG on arrival. On 2026-10-30 it listed no route from BSC and
  answered `ROUTE_NOT_ENABLED`.
- Relay's `chains` endpoint marks each currency that bridges. USDC and USDT pair from BSC to
  Ethereum, Base, Arbitrum One and Solana. Robinhood Chain lists only ETH and USDG, yet Relay's
  quote fills BSC USDC and USDT as USDG there (20 USDC quoted at 19.93 USDG). Relay also sells BNB
  for ETH or SOL.
- Across delivers WETH to an account with no code as ETH.

The specs name the delivered token (USDC arrives on Robinhood Chain as USDG) but not which routes
to list.

## Decision

- A route is listed when the bridge's own API serves it from BSC and it moves a dollar stablecoin
  to a dollar stablecoin, or ETH to WETH or ETH. A route that sells one coin for another (BNB for
  ETH or SOL) is a trade, never a bridge.
- A dollar stablecoin may arrive as the destination's own dollar only where no route delivers the
  same token, and only when the bridge fills it in one step: Relay's USDC and USDT to USDG on
  Robinhood Chain. Across's two-swap path to USDG is not listed.
- Old bridged forms (Base USDbC, Arbitrum USDC.e) are not listed; the native USDC reaches the same
  chain.
- The registry keeps each bridge's routes with the endpoint and the day they were read
  (`bscBridgeRoutes`). The bridge's own answer at quote time still decides: a route the bridge no
  longer serves answers `no_route`.
- A destination token no route reaches is not in the registry, so it is offered nowhere.

## Consequences

- Solana is served by Relay alone, and Robinhood Chain's USDG by Relay alone. If the ceiling cannot
  bind Relay's deposit (decision 0297), Solana and USDG on Robinhood Chain leave with it, and
  Robinhood Chain keeps only Across's ETH route.
- A WETH route's delivery is read in WETH and in ETH, since an account with no code receives ETH.
- `pnpm chains:read` reads the routes again; a route a bridge drops leaves the registry in the
  next change.

## Alternatives

- **List every pair each API quotes.** Relay quotes almost any pair from BSC, so the list would be
  a trading menu, and a "bridge" could sell BNB at a solver's price. Lost: a bridge keeps value.
- **List Across's USDC to USDG on Robinhood Chain.** It runs two DEX swaps around the bridge, each
  with its own slippage, for a route Relay serves in one fill. Lost.
- **Read routes only live, keep none in the registry.** The card, the agent and the address book
  could not say which chains and tokens exist without a network call, and a chain no bridge serves
  could reach the owner. Lost.
