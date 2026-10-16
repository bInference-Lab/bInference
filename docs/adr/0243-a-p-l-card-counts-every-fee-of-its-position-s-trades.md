# 0243. A P&L card counts every fee of its position's trades

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

Spec 4, section 3.7 fixes the P&L card's lines: an open card with the holding, the average cost,
unrealized and realized P&L and the fees; a closed card with what the buys cost, what the sales
brought in, the realized P&L and how long the position was held. Its closed example has sold for
minus bought for equal to the realized P&L, with the fees of both the buys and the sales on the
card. The spec does not say where each figure comes from.

The ledger keeps P&L at average cost ([decision 0058](../DECISIONS.md#d0058)). An execution's venue
fee and gas go into the cost of what it bought. A sale's fee and gas therefore sit in the cost of
the coin it received, and the sold token's realized P&L in its position row does not hold them.
Each execution stores what it realized ([decision 0137](../DECISIONS.md#d0137)), which rejected
replaying the ledger at read time. A position row is kept per wallet, asset and mode and is never
deleted: it holds the realized P&L of its whole life. A paper reset empties every paper row, P&L
too. Sends out of a wallet leave positions at cost with nothing realized
([decision 0127](../DECISIONS.md#d0127)).

## Decision

- **One card per position of an agent in one mode:** the agent's rows of the asset in all its
  wallets, archived ones too, added up. It is open while they hold units. It is closed when they
  hold none and a sale of the asset falls in its span; its closing time is the latest change of
  its rows.
- **The span** of a position runs from its first trade or valued arrival on, and a paper
  position's from the last paper reset. A position that empties and is bought again keeps one
  card, as its row keeps one realized P&L. Nothing is replayed.
- **Fees:** the venue fee and the gas of every execution in the span that bought or sold the
  asset, each in USD at its time.
- **Bought for:** what the buys cost with their fees and gas, plus the value of the funds that
  arrived. **Sold for:** each sale's value minus its gas; the venue fee was paid on top of the
  units sold.
- **Realized P&L on the card** is the rows' realized P&L minus the venue fees and gas of the span's
  sales, so it is net of every fee and gas. For a position closed by sales alone it equals sold for
  minus bought for.
- A trade between two positions shows its fees on both cards: the token sold counts them against
  its realized P&L, and the coin received holds them in its cost. Cards are never added together;
  the totals of `portfolio/pnl` count each dollar once.
- **Rounding:** stored values at the time are used as stored (rounded up). The value now rounds
  down. The average cost per whole token rounds up. A percentage is worked out in basis points
  from integers and rounds toward minus infinity, so a gain never shows larger and a loss never
  smaller. An open position's percentage is over its cost, a closed one's over what it was bought
  for; with a base of zero it shows `n/a`.
- **No price now:** the holding line has no value and the P&L line says so (`pnl.noPrice`). A token
  whose decimals no source knows is named by its short address, and the holding and cost lines are
  left out (spec 4, section 3.1).
- Amounts use the one formatter (spec 4, section 1): USD with 2 decimals, so an average cost under
  a cent shows `<$0.01`.
- The engine draws the cards as card lines. `portfolio/pnl` answers them with `cards: true`: the
  agent's open positions and those closed from `from` to `to`, live before paper, each mode's open
  ones first by value, then its closed ones, the latest first. `/positions` asks for the last 7
  days of every agent not archived.

## Consequences

- A card reads only what the ledger already stores: the position rows, the executions and the
  arrivals. No migration and no change to the money path's writes.
- A token's card shows what trading it made after every fee, as an owner reads a trade.
- A coin a sale paid into, such as BNB or USDT, holds that sale's fees in its cost, as the ledger
  does, so the fee shows on its card too. Summing the cards would count it twice.
- A position emptied and bought again shows one card from its first buy. A position emptied by a
  send has realized less than sold for minus bought for, since the units sent left at cost.
- The console can draw the same lines by `cardLineText`.

## Alternatives

- **The ledger's realized P&L unchanged on the card.** Each dollar once across cards, but a closed
  trade's P&L would leave out its sale's fee and gas, and sold for minus bought for would not
  match it. Rejected.
- **Spans that end when a position empties, found by replaying the ledger.** Needs the departures
  and every earlier row in order, and could drift from the stored positions, as decision 0137
  found. Rejected.
- **A stored opening time and fee totals on each position row.** A migration and a change to every
  position write for a display. Rejected.
- **Figures on each position of `PnlView` for every surface to draw its own card.** The console
  cannot import the engine's drawing, so the card's rules would live twice. Rejected; `PnlView`
  carries the drawn cards instead.
- **Charging fees to the token side of a trade only.** The registry has no notion of a quote asset,
  and core code names no chain's coin. Rejected.
