# 0214. The registry lists the pool hooks a route may pass, with each hook's fee

Status: Accepted

Accepted by the owner on 2026-10-14.

## Context

ARCHITECTURE section 7 keeps one hook allowlist for every route: a route through a PancakeSwap
Infinity or Uniswap v4 pool whose hook is off the list is dropped. The list has been empty, so
every hooked pool was dropped.

A Genius.fun launch graduates into a PancakeSwap Infinity CL pool with its stack's hook
(`GeniusMemeHook`). Read on chain on 2026-10-14: each stack's hook names its stack's factory, keeps
2% of the unspecified side of every swap (`hookFeeBps()` 200), and a pool keeps the share it was
registered with (200 on a graduated pool of each stack). KyberSwap prices such a pool by running
its hook: for 0.01 BNB of a graduated m4.1 token, its route out matched PancakeSwap's Infinity
quoter to the wei at block 127652047. So the fee is already in the quote's output and in its price
impact, but nothing names it.

On the same day KyberSwap routed graduated m4.1 tokens through their Genius.fun pools, and
graduated m4.2 tokens only through other pools: it does not index the m4.2 hook's pools yet.

## Decision

- **The registry holds the allowlist.** Beside each chain, a list of pool hooks routes on the chain
  may pass (`bscPoolHooks`): each a registry contract, by its venue and name, with the fee it keeps,
  read on chain, and who made its pools, as a card names them. BNB Smart Chain lists Genius.fun's
  two hooks at 200 bp.
- **The composition root gives it to the aggregators.** KyberSwap takes each allowed hook with its
  fee and maker.
- **A quote names the fee.** A quote whose route passes allowed hooks names, for each maker of
  their pools, the sum of their fees along the maker's costliest path, a pool counting the dearest
  of the candidates nested in it, and the maker's hooks it passes (`hookFees`); its expected
  output already holds the fee back.
- **The card and the maximum tax read it.** The card shows it on a line of its own, and it counts
  toward the agent's maximum tax ([decision 0215](0215-a-pool-hook-s-fee-shows-on-the-card-and-counts-toward-the-maximum-tax.md)).

## Consequences

- A graduated Genius.fun token routes through its own pool wherever an aggregator indexes it.
- A new hook is a registry entry, read on chain, and its fee; no code changes.
- `VenueQuote` gains `hookFees`, and `KyberswapChain.allowedHooks` takes each hook's fee and maker.

## Alternatives

- **Keep the list empty.** Graduated Genius.fun tokens would trade only through pools other people
  made, often thin. Rejected.
- **Count the hook's fee as the token's tax.** The pool keeps it, as any pool keeps its fee, and the
  card would call it a tax of the token. Rejected.
- **Read each pool's fee on chain at each quote.** An aggregator's answer names the hook, not the
  pool's registration; a read per quote adds a call to every route for a fee fixed per hook so far.
  Rejected while the registry's fee matches every pool read.
