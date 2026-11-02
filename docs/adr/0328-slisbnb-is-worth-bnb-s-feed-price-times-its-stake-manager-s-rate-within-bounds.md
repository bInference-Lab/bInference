# 0328. slisBNB is worth BNB's feed price times its stake manager's rate, within bounds

Status: Accepted

Accepted by the owner on 2026-11-02.

## Context

[Decision 0059](../DECISIONS.md#d0059) prices on chain first: BNB and WBNB from Chainlink's BNB/USD
feed, stablecoins at $1 while their feeds hold the peg, and every other token from the trade's
own quote. slisBNB, Lista's liquid staking token, needs a price of its own: positions and paper
portfolios value it, trades that sell or buy it count against the caps, and a slisBNB staking venue
that comes later prices its moves with it. A quote prices it only inside a trade, and a position
or a stake has no quote.

Lista's developer docs name the stake manager `0x1adB950d8bB3dA4bE104211D5AB038628e477fE6` and
slisBNB `0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B` on BSC, both in the registry since
2026-10-06, and say to value slisBNB through the stake manager's
`convertSnBnbToBnb(uint256)`: slisBNB earns by its exchange rate, not by rebase. That function
answers `amount * totalPooledBnb / slisBNB.totalSupply()` rounded down, both in 18 decimals, and
stays readable while the contract is paused; Lista's own lending oracle prices slisBNB the same
way, BNB's price times that rate. Read on 2026-11-02 at block 131,229,177: one slisBNB converts to
1.039342452779596239 BNB, `paused()` is false, and the stake manager is a proxy with an
implementation and an admin.

The contract's guards are not the rate's. `paused()` stops deposits, withdrawals and claims
(a guardian pauses, a manager unpauses), not the views. With no supply or no pooled BNB the
function divides by 1 instead, so an empty or broken pool answers a rate that is not one. A proxy
upgrade, or a move of slisBNB's minting to another manager, can make the registry's manager answer
any rate, a wrong one inside the bounds too.

Chainlink lists a "slisBNB / BNB Exchange Rate" feed on BSC
(`0xea93C82fa07773ed645d8A79eE27041eb867f221`, its `custom` category): 18 decimals, a heartbeat of
86,400 s. At block 131,234,982 it answered 1.039342452779596239, the stake manager's rate, last
updated about 11 hours earlier.

## Decision

The owner chose the stake manager as the source of the price, refused outside 1 to 1.2 BNB or while
paused. The lead hardened that design with the feed check and the rule that no quote stands in.

- A registry token can be priced by a rate: the chain's file lists, beside its Chainlink feeds,
  the token, the venue contract that converts it, that contract's view function
  (`name(uint256) returns (uint256)`), the least and most coin one whole token may convert to in
  basis points, and the Chainlink feed of the same rate with its decimals, heartbeat and the most
  the two may differ. BSC lists slisBNB through Lista's `stake-manager` and `convertSnBnbToBnb`,
  bounded from 1 to 1.2 BNB, checked against Chainlink's slisBNB / BNB feed within 1%.
- Such a token is worth the coin's price from the feeds times what the contract converts one
  whole token to: micro-dollars per base unit, an exact ratio over the contract's own rounded-down
  answer, which the caller rounds. The engine's policy rounds the value up, as for any outflow.
- The coin's price is read first; without it the token has no price and no rate is read. Then one
  Multicall3 call at the block the chain's failover names newest reads the block's time,
  `paused()`, the rate and the feed's round, within 5 seconds in all. A rate that passes every
  check serves every ask for 3 seconds; a failed read is never kept.
- The token has no price, never a guessed one, when the coin has none, the block is older than
  30 seconds by the clock, the contract is paused, the rate is outside its bounds (zero among
  them), the feed is older than its heartbeat and 30 seconds or answers zero, the rate and the
  feed differ by more than 1%, a call reverts or answers outside its shape, or the read fails or
  runs out of time.
- That refusal is final: the price source answers `price_refused`, and no trade's quote stands in
  for it. Every step that prices the token, the policy, the wallet queue's recheck, paper fills,
  reconciliation and order fills, then ends in `no_price`.
- The token's own price wins over a quote: a trade that sells or buys slisBNB is valued at the
  rate, not at what its venue quotes. A slisBNB sale counts against the caps at that value.
- govBNB, the voting token StakeHub mints with a stake, gets no price. It does not transfer, a
  position is the venue's receipt token (credit shares, slisBNB), and an unstake burns it with the
  stake, so a price for it would count the stake twice.

## Consequences

- The self-hosted policy and positions value slisBNB the same way at every step, with or without a
  quote. The hosted profile has no price adapter yet, only a test fake of a market-data service;
  when it is built it prices slisBNB by this rule.
- A slashing that drops the rate under 1 BNB, or rewards that lift it past 1.2 BNB, leave slisBNB
  without a price until the registry's bounds change in a release. At about 2.5% a year the rate
  reaches 1.2 in roughly six years.
- A paused stake manager, a stale or silent Chainlink feed, or a rate more than 1% from the feed
  stops every slisBNB trade, and its positions show no value until both agree again. A wrong rate
  inside the bounds is caught by the feed, so an upgrade or a manager move does not undervalue
  slisBNB unnoticed.
- Each slisBNB price costs two requests, the head block and one Multicall3 call, besides the coin
  feed's one, at most once every 3 seconds.
- A second liquid staking token is a registry entry, not code, as long as its contract answers a
  conversion of that shape and `paused()`, and a Chainlink feed states the same rate.

## Alternatives

- **Chainlink's slisBNB / BNB exchange rate feed as the source.** It is a `custom` feed updated
  about once a day. The stake manager answers at the block it is read; the feed only guards it.
- **The trade's own quote ([decision 0059](../DECISIONS.md#d0059)), also as a fallback.** A
  position has no quote, and a thin pool's quote can move far from what slisBNB redeems for; a
  paused manager after an exploit is when that pool is least to be trusted.
- **One slisBNB at one BNB.** It undervalues slisBNB by the rewards it has earned, so the caps
  would let through more than the owner set.
- **No bounds, or a floor below 1 BNB.** A broken pool answers a rate the function never refuses;
  a low price is the direction that loosens a cap, so the floor stays at 1.
- **A floor raised to the live rate each release.** It needs a release to follow the rate and still
  misses a wrong rate above it; the feed check catches both.
