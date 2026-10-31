# 0299. A webhook rule fills once a minute unless it names a rate up to sixty

Status: Accepted

Accepted by the owner on 2026-10-30, with the rate allowed up to 60 a minute.

## Context

[Decision 0053](../DECISIONS.md#d0053) lets an inbound webhook fill only a rule the owner made in
the console or the CLI and confirmed once; each alert fills inside the rule's bounds with no model.
Spec 1 gives the listener's answers (`202`, `404`, `409`, `429`) and its 16 KiB body, and
`webhookRule/create` takes an auto order's fill bounds and a name. The engine database already
keeps `rate_per_min` per rule, and the rule's card reads "at most {rate} a minute". Nothing says
what that rate is, how many rules an agent may hold, how many fills a rule may make, or what an
alert's body may change.

Anyone who learns a rule's URL can send it alerts. TradingView, the sender the exit tests name,
sends a body the owner writes, from TradingView's servers, at most as often as the owner's
alert fires.

## Decision

- **The body only fires.** A rule's bounds decide every fill. An alert's body may carry an `id`, a
  string of at most 128 characters that is its repeat key (spec 1, section 2.2); nothing else in
  it is read.
- **The rate.** `ratePerMinute` is 1 to 60, default 1: the alerts a rule accepts in any 60
  seconds. One more is answered `429` and recorded as `rate`.
- **The bounds.** A rule takes the bounds of an auto order: its wallet, token, side, size, worst
  price, maximum slippage, expiry (30 days by default) and most fills, and for a buy what it
  spends, as an order does (decision 0190). With no `maxFills` it fills until it expires or is
  deleted, as a copy order does. Every fill passes the per-trade and 24-hour caps.
- **At most 20 rules per agent,** active or awaiting their card; one more fails
  `webhook.too_many`.
- **Live fills.** A live agent's rule is refused with `order.live_fills_off` while live webhook
  fills are off, which the second step of turning on live fills ends.
- **One card.** `webhookRule/create` stores the rule `awaiting_confirmation` and an intent of the
  new kind `webhookRule`, whose one card shows the bounds and the rate. The rule is `active` only
  on its Confirm, and its URL works only then; Cancel, the card's timer or a freeze ends it.

## Consequences

- A leaked URL can fill a rule at most its rate a minute, inside its bounds and the agent's caps,
  until the owner rotates it or deletes the rule.
- A TradingView strategy that fires faster than sixty times a minute cannot run as one rule.
- The intent kinds gain `webhookRule`, a new value of an existing field, which protocol v1 allows.

## Alternatives

- **Let the body set the size or the side.** A forged alert could then choose them inside the
  bounds.
- **No rate, only the repeat window.** A leaked URL with a new `id` each time could fill as fast
  as the engine runs.
- **A default fill limit.** Any number would be a guess; the expiry and the caps bound a rule
  already.
