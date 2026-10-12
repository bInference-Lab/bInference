# 0179. A buy or sell goes nowhere while its place is in doubt

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 6](../specs/intent-states.md) section 5 sends a `buy` or a `sell` to the curve of the
launchpad that holds its token, and to the pools when none does. An aggregator cannot trade a token
still on a curve, but a pool of that token may exist anyway, made by anyone with a few dollars,
and an aggregator would route through it at a price the curve never set. The spec says what
happens when two launchpads claim a token, and when the launchpad is not among the agent's venues.
It does not say what happens when a launchpad cannot answer, which launchpads are asked, or which
assets a buy may spend: [spec 1](../specs/protocol.md) section 8.1 says only "BNB or a stablecoin".

## Decision

- **Every launchpad is asked.** The venue host asks every launchpad it holds on the token's chain,
  all at once and under its call timeout, not only those among the agent's venues. So a token on
  the curve of a launchpad the agent may not use ends `rejected_policy` with `venue_off`, as spec 6
  says, instead of going to the pools.
- **A launchpad that cannot answer stops the trade.** A launchpad that throws, times out, answers
  outside its types, or names a quote asset off the token's chain ends the intent `failed_check`
  with `venue_down`. The trade never falls back to the pools.
- **A buy spends the chain's coin or a token the chain registry lists.** The registry is the list
  of tokens binference has checked on chain; its stablecoins are among them. Any other `spend` is
  `protocol.bad_args`, and nothing is stored.
- **A sale by share reads the holding when its quote is built,** at the first quote and at each
  re-quote, and the wallet queue judges the trade the confirmed quote runs, never a new share.

## Consequences

- One launchpad's outage stops every buy and sell on its chain until it answers, the owner's tokens
  in the pools included. A swap, which names its assets and asks every venue, still works.
- A new launchpad plugin adds one read to every buy and sell on its chain, before any quote, under
  the venue host's call timeout.
- A buy that spends another token is a `swap`, which the agent's tools also offer.

## Alternatives

- **Send the trade to the pools when a launchpad cannot answer.** A curve token would then trade
  through whatever pool exists for it. Rejected: it fails open on the money path.
- **Ask only the launchpads among the agent's venues.** A curve token of another launchpad would go
  to the pools for the same reason. Rejected.
- **Let a buy spend any token.** The policy would still value it, but a buy is the agent's way to
  enter a position with money, and a swap already covers the rest. Rejected.
