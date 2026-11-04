# 0362. A new order or rule above the slippage limit is refused before its card

Status: Accepted

Accepted by the tech lead on 2026-11-04.

## Context

An auto order (`order/create`, decision 0189) and a webhook rule (`webhookRule/create`, decision 0336) may name `maxSlippageBps`. Each fill is a `buy` or `sell` intent that runs the policy again
(decision 0195), and the policy refuses a request whose slippage is above the agent's limit for its
pair, `slippage` (spec 6, section 4): `limits.slippageBps.registry` when both assets are registry
tokens, `limits.slippageBps.other` for any other pair (`tradeSlippageBps`). Neither operation read
that limit, so an owner could confirm a card that said "at most 1.50% slippage" for a rule whose
every fill then skipped with `slippage`. The rule looked active and never filled.

What its fills trade is known at creation for every kind but one. A price order, a DCA order and a
webhook rule name their token, and a buy names what it spends, the chain's coin when it names none;
a sale receives the coin or a registry token. A copy order names its leader's chain coin as its
token (decision 0261): the token each fill trades is the leader's, which only a fill knows.

## Decision

- `order/create` and `webhookRule/create` refuse, before anything is stored and before any card, a
  request whose `maxSlippageBps` is above the agent's slippage limit in effect for the pair its
  fills trade, read by the same `tradeSlippageBps` the fill check uses. The refusal is the protocol
  error `order.slippage_limit`, whose words name the limit and the two next steps: lower the
  slippage, or raise the limit with `binference limit set`.
- A copy order is refused only above the larger of the two limits, since its fills may trade a
  registry token or any other. A copy fill of a registry token still skips with `slippage` when the
  order asks more than the registry limit.
- The check runs after the agent's own refusals and `order.live_fills_off`, so an order that could
  never fill for its mode says that first.
- The fill-time policy stays as it is: a limit tightened after creation skips each fill with
  `slippage` and its notice.

## Consequences

- An owner never confirms a card for an order or rule that every fill would skip for its slippage.
- A request that leaves `maxSlippageBps` out is never refused here; each fill takes the agent's
  limit for its pair.
- A looser limit that waits its 24 hours (decision 0111) is not in effect yet, so a request above
  the limit now is refused until it applies.
- Every surface reads the same code: the CLI, Telegram and the console show its words in English
  and Chinese, and the agent's tools and MCP clients read the code.

## Alternatives

- Refuse a copy order above the smaller of the two limits. It would refuse a copy order whose
  fills of tokens outside the registry, most of what a leader buys, would all pass.
- Clamp the asked slippage to the limit. The card would then show terms the owner did not ask for,
  and the confirmed terms would differ from the request.
- Warn on the card and take the order. The owner could still confirm an order that never fills.
