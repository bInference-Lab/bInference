# 0213. A buy waits out its launch's snipe tax, and exempt wallets count as insiders

Status: Accepted

Accepted by the owner on 2026-10-14.

## Context

Genius.fun's curves take a snipe tax on buys in the first seconds of a launch. Its verified curve
source sets it from the launch's start rate (9,900 bp on stack m4.2) and halves it 14 times across
the window (15 seconds), so the buyer keeps at least 1% of the spend. The tax depends on the buyer:
`currentSnipeTaxBps(recipient)` reads 0 for a wallet the creator exempted at launch. A bot buy in a
launch's first second paid 99% of its spend this way (checked on 2026-10-06).

[Decision 0181](0181-a-venue-s-own-tax-counts-as-the-leg-s-tax.md) counts the tax a venue's own
contract takes, named in the quote's `taxBps`, as the leg's tax, and the risk step refuses a leg
above the agent's maximum tax with `high_tax`. That reason tells the owner the token always taxes
every trade, which a snipe tax does not: it is gone seconds later.

The wallets a launch exempts, the creator's, its fee recipient's and those the creator names, buy
untaxed while everyone else pays. Spec 1 already lets the launch feed and the risk step name such
wallets as a token's insiders.

## Decision

- **The quote names the snipe tax.** A venue quote may carry `snipeTaxBps`: the part of its
  `taxBps` the venue's contract takes on this buy because the launch is young, for the request's
  wallet at the latest block. It is never more than `taxBps`.
- **The risk step refuses it by name.** A buy whose quote's snipe tax is above the agent's maximum
  tax is `risk_blocked` with `snipe_tax`, checked right before `high_tax`. Below the maximum, it
  still counts in the buy leg's tax under decision 0181.
- **Insiders go on the risk view.** A launchpad may read, for a token it launched, the wallets its
  contracts favor (`insiders`); the risk step asks the trade's venue and records them on the
  `RiskView`. A launchpad that cannot read them names none: insiders inform, they never refuse.

## Consequences

- A buy in a launch's first seconds is refused with a reason that says it is the launch window; the
  same buy a few seconds later passes, at whatever tax is left.
- Every launchpad with a launch-window tax names it the same way; aggregators leave it out.
- `VenueQuote` gains `snipeTaxBps`, `RiskView` gains `insiders`, the venue host gains
  `insiders`, and spec 6 gains the risk reason `snipe_tax`, with its message in English and
  Chinese.

## Alternatives

- **Keep `high_tax`.** The owner reads a permanent tax where there is a passing one. Rejected.
- **Wait out the window and quote again.** The money path would hold an intent for seconds on a
  venue's say; the agent can propose the buy again. Rejected.
- **Refuse any buy with a snipe tax.** A tax of a few basis points near the window's end costs less
  than the fee. Rejected: the agent's maximum tax decides, as for every tax.
