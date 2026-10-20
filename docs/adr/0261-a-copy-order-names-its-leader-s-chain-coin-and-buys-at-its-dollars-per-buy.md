# 0261. A copy order names its leader's chain coin and buys at its dollars per buy

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 1](../specs/protocol.md) section 8.2 gives every auto order request a `token`, a `side` and a
`size`, and a `copy` order the trigger `{ leader, perBuyUsdMicros, dailyUsdMicros }`.
`order/create` refused the kind with `order.kind_unavailable` until something copies the leader's
trades ([decision 0189](0189-an-auto-order-starts-on-its-card-s-tap-and-pauses-while-its-agent-is-frozen.md));
[decision 0260](0260-a-copy-order-copies-each-leader-trade-once-at-its-own-size-inside-its-caps.md)
now does. A copy order trades every token its leader trades, so one `token` cannot name what it
buys, and the protocol keeps the request's shape within a version: a field becomes optional only
in a new version. The card's summary, `card.order.summary.copy`, names the leader, the dollars per
buy and a day. The specs leave open what the shared fields mean for a copy order, and which leader
it may follow.

## Decision

- **`token` names the chain.** A copy order's `token` is the coin of its leader's chain: it copies
  every token the leader trades there. Any other token is `protocol.bad_args`.
- **It buys.** `side` is `buy`; its sales follow the leader's
  ([decision 0260](0260-a-copy-order-copies-each-leader-trade-once-at-its-own-size-inside-its-caps.md)).
  A `sell` is `protocol.bad_args`.
- **One number per buy.** `size` is `{ usdMicros }` and equals `perBuyUsdMicros`, at least $5, the
  least a copy buy spends ([decision 0260](0260-a-copy-order-copies-each-leader-trade-once-at-its-own-size-inside-its-caps.md)), as a
  DCA order's `count` and `maxFills` must agree; `dailyUsdMicros` holds at least one buy. A worst
  price would hold one token's price for every token, so a copy order names none.
- **What it spends** is the chain's coin, or a token the registry lists on that chain, as for any
  buy order ([decision 0190](0190-a-buy-order-spends-a-named-asset-by-amount-or-by-share.md)).
- **No fill limit by default.** It copies until it expires, 30 days by default, unless it names
  `maxFills`, which counts buys and sales.
- **The leader** is an account on a chain the registry holds, kept in its canonical form, so the
  leader watcher's rows name it the same way. An account of any wallet of the install, of this agent
  or another, archived ones among them, by the address the install keeps or the one custody holds,
  is `protocol.bad_args`: its copies would be the leader's trades in turn, and two agents copying
  each other would buy without end. A leader that becomes a wallet of the install later, as a wallet
  attached from another machine may, is followed no more: the copy order passes over each of its
  trades with no row.
- **Live waits.** While live fills are off, a live copy order is `order.live_fills_off`, as a live
  price or DCA order.
- **The card.** `card.order.summary.copy` names what the order spends and its leader by short
  address, after the agent's address book label when it has one, so a label never hides the
  address. The `autoOrder` intent's quote holds the whole request, so the card's terms hash
  binds the leader, the caps, what it spends, its slippage, its expiry and its fill limit.

## Consequences

- `order/create` refuses no kind with `order.kind_unavailable`; the code stays in the protocol.
- Spec 1 sections 7.5 and 8.2 say so; the agent's `order_create` tool says how to write one.
- `/orders` and the agent's live facts show a copy order's chain coin as its token.

## Alternatives

- **Make `token`, `side` and `size` optional for a copy order.** The cleaner shape, but a change of
  the request and of the order view, which waits for the next protocol version. Rejected for now.
- **`token` as a filter: copy one token's trades.** A copy order would miss every new token its
  leader buys, which is what owners copy a wallet for. Rejected.
- **Size a buy as a share of the leader's buy.** A whale's buy would size ours; the spec copies each
  buy at its own dollars. Rejected.
