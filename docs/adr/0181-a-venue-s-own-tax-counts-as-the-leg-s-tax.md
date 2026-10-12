# 0181. A venue's own tax counts as the leg's tax

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Decision 0113](0113-each-leg-s-tax-is-measured-from-the-round-trip.md) reads each leg's tax from
the transfers of a simulated round trip: of the token the pools paid out, the share that never
reached the buyer, and of the token sold, the share that never reached the pools.

Flap charges a tax token's tax on its bonding curve as an extra fee in the quote token, taken by
the Portal on top of its own fee ("PreBond Tax", docs.flap.sh, read on 2026-10-12). The buyer
receives every token the curve releases, and the Portal receives every token sold, so the round
trip reads 0 on both legs. A curve token with a 10% tax would pass an agent's 5% maximum.

The Portal reports each token's buy and sell tax rates (`getTokenV8Safe`), and its quote already
deducts them.

## Decision

- **The venue names it.** A venue quote may carry `taxBps`: the token tax the venue's own contract
  takes on this trade, which no transfer shows. A launchpad reads it from its own contracts before
  it quotes: the buy rate for a buy, the sell rate for a sale.
- **The round trip counts it.** The buy leg's tax is the higher of what its transfers show and the
  tax the trade's own quote names; the sale leg's, the higher of what its transfers show and the
  tax the sale's quote names. The agent's maximum applies to the highest leg, as before, and the
  card's tax line and the risk view show it.
- A tax the token takes on its transfers is still measured, never taken from a venue or a source.

## Consequences

- A curve token's tax is judged against the agent's maximum before any card opens.
- A venue that names a tax lower than its contract takes is a venue bug the round trip cannot see;
  each launchpad's fork test checks its quote against the rate its contract reports.
- `VenueQuote` gains `taxBps`. Aggregators leave it out: their quotes deduct taxes that transfers
  show.

## Alternatives

- **Ask the risk sources for the tax.** Decision 0113 rejected their figures. Rejected.
- **Read the tax from the quote token's transfers in the round trip.** The curve's own fee leaves
  in the same asset, and which share is tax depends on Flap's contracts behind the Portal's proxy,
  which Flap can change. Rejected.
- **Count the venue's whole fee as tax.** The curve's own fee is not the token's tax, and would
  refuse every curve token at a low maximum. Rejected.
