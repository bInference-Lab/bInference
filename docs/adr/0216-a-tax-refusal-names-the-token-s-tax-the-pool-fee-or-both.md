# 0216. A tax refusal names the token's tax, the pool fee, or both

Status: Amended by 0219

Accepted by the owner on 2026-10-15.

## Context

[Decision 0215](0215-a-pool-hook-s-fee-shows-on-the-card-and-counts-toward-the-maximum-tax.md)
counts the fee a route's pool hooks keep, once, with the buy leg's tax against the agent's maximum
tax, and refuses a route over it as `high_tax`. Its message reads "the token takes a high tax on
every trade". A graduated Genius.fun token takes no tax of its own, and its pool keeps 2% of every
swap: at a maximum below 2% its buy is refused with words that blame a tax the token does not take,
on every trade, where only the buy's route pays the fee.

The risk step knows which parts made the figure it refused: the buy's tax, the sale's tax, the
transfer's tax, and the pool fee, which counts on the buy alone.

## Decision

- **The refusal names what counted.** A tax above the maximum stores one of three risk reasons:
  - `high_tax` when a transfer, a sale, or a buy whose route keeps no pool fee is over the maximum
    on the token's own tax;
  - `high_pool_fee` when the buy is over only with its route's pool fee and the token takes no tax
    on the buy;
  - `high_tax_with_pool_fee` when the buy's tax and the pool fee together are over it.
- A leg over the maximum on the token's own tax names `high_tax` first, whatever the buy's fee.
- Each reason has its message in English and Chinese, in spec 4's words: "the pool fee on this
  route is above your maximum tax; the token itself takes no tax on a buy", and "the token's tax on
  a buy and the pool fee on this route together are above your maximum tax".

## Consequences

- The owner reads the cost that blocked the trade, and can tell a pool's fee from a token's tax.
- Spec 6 lists the two new risk reasons; the stored reason codes gain them, which the protocol
  carries as text.
- Nothing else changes: the same trades are refused at the same maximum.

## Alternatives

- **Keep one `high_tax` and change its words.** One message cannot name a fee for one token and a
  tax for another. Rejected.
- **Store `high_tax` with the parts as values of its message.** A reason stored with an intent
  carries no values. Rejected.
