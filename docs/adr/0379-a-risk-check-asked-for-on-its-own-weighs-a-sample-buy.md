# 0379. A risk check asked for on its own weighs a sample buy

Status: Accepted

Accepted by the tech lead on 2026-11-07.

## Context

`risk/check` takes a token and answers its `RiskView`. The money path's risk step weighs the token
a quoted trade buys: its sources, a round trip built on the trade's own venue, the snipe tax and
the pool fees the quote names, all held to the agent's tax and liquidity limits. A token alone has
no trade, no venue and no agent, so the engine served no handler for `risk/check`, and every
`token_risk` call failed.

## Decision

- `risk/check` gains an optional `agent`, an addition to protocol version 1. Without it the check
  runs for the oldest agent not archived; with none, it is `agent.not_found`.
- The check quotes a sample buy of the token for one hundredth of a whole coin of the token's
  chain, from the agent's wallet in its mode, placed and quoted as a proposal is
  ([decision 0107](../DECISIONS.md#d0107)): the best expected output within the agent's maximum
  price impact.
- It runs the money path's own risk step on that quote with the agent's tax and liquidity limits,
  and answers the step's view. A token the registry lists passes, as in the money path.
- No venue that quotes the sample is `quote.no_route`, a venue that does not answer
  `quote.venue_down`. Nothing is built, simulated, signed or stored, but the sources' reports go to
  the risk cache as in the money path.
- The agent's `token_risk` tool names its own agent.

## Consequences

- An agent can check a token before it proposes a trade, with the same verdict a proposal would
  get at the sample's size.
- A token whose tax or liquidity depends on the trade's size may answer differently at the size
  a proposal names; the proposal's own risk step still decides that trade.

## Alternatives

- **Weigh the sources alone, with no round trip.** The view would miss the taxes binference
  measures itself and the snipe tax, which the money path reads from a quote.
- **Require `agent`.** MCP clients and the console already call `risk/check` with a token alone.
- **Size the sample in dollars.** It would need a price before the quote, which an unlisted token
  may not have.
