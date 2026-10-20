# 0278. Brew trades in its pools, and only its single-pair factory's launches count

Status: Accepted

Accepted on 2026-10-20.

## Context

[Decision 0081](../DECISIONS.md#d0081) names Brew among the v1 launchpads. Its sources, read on
2026-10-20:

- **Its docs** (brew.family/docs): "Brew launches your token directly into a PancakeSwap V3 pool
  on BSC". Every launch has a supply of 1,000,000,000, a 1% pool fee and liquidity "locked
  permanently in Brew's locker". The contract list names BrewFactory
  (`0xeEa6C3bfb29Fd9a35380438956bae7B109c63d85`), BrewLiquidityLocker, BrewDistributorFactory, two
  multi-pair factories with their lockers, and the PancakeSwap pieces the pools use.
- **Verified sources** on Sourcify, chain 56, an exact match each: BrewFactory, with `BrewToken`
  and `BrewLiquidityLocker` among its sources, and BrewDistributorFactory. The multi-pair
  factories are not verified.
- **What the source says.** One `launch` call makes a `BrewToken` (fixed supply, 18 decimals, no
  owner, no mint, no tax, no transfer hook), creates its PancakeSwap V3 pool, places the whole
  supply in it as liquidity the locker holds for good, and records the launch in
  `launches(token)`. In that same call it writes `TokenLaunched` with the token's words and pool,
  then `InitialBuyExecuted` for a first buy. Nothing in the factory trades a token after its
  launch: from the first block, a buy or a sale is a swap in a public PancakeSwap V3 pool.

## Decision

- **No trade adapter.** Brew's tokens trade through the aggregators, KyberSwap and OKX, which
  route PancakeSwap V3 pools, and the best quote wins, as for any token. The `brew` venue quotes,
  builds and decodes no trade: its quote is `no_route`, its build throws `brew.no_trade`, and its
  decoder answers `unknown_call`. It has no curve, so it is no launchpad in the host's sense and
  no buy or sale asks it where a token is.
- **Only the single-pair factory counts.** The registry lists BrewFactory as `brew/factory`, with
  its locker and the distributor factory, each read on chain. A token is Brew's exactly when that
  factory's `launches(token)` records it, which happens in the call that writes `TokenLaunched`.
  The multi-pair and dividend factories, whose code is not verified, stay out of the registry:
  their tokens are unknown to binference, are on no launch feed as Brew's, and trade as any other
  token, through the full risk step.
- **The launch feed.** The venue's launch reading (decision
  [0254](0254-a-launchpad-reads-its-launches-from-their-transaction-s-logs.md)) believes a
  `TokenLaunched` only from the listed factory: the token, its creator, its name and symbol, and
  its pair, the chain's coin when the pool holds the wrapped coin, as Brew's docs describe a BNB
  pair. The recipients of the same factory's `InitialBuyExecuted` for that token are its insiders.
  A Brew token reads as graduated, since it trades in its pool from the launch on, with no tax and
  no snipe tax, as its source has none. No read completes it: the logs carry every fact.

## Consequences

- `@binference/brew` holds the venue; the composition root runs it on each chain whose registry
  lists the factory, and the feed reads its launches with the other launchpads' in one log query
  a block (decision [0256](0256-the-launch-feed-reads-every-launchpad-in-one-log-query-a-block.md)).
- A Brew token's insiders reach the launch feed only. The risk step asks the venue that quoted the
  trade, an aggregator, which names none.
- The fork suite buys a Brew token through KyberSwap and holds a token with no launch record to
  the same path as any other token.

## Alternatives

- **A trade adapter on the launch pool**, through PancakeSwap's QuoterV2 and Smart Router. The
  aggregators already route these pools and pick the best of them; a second route to the same pool
  adds code and no price. Rejected.
- **Read `launches(token)` for each buy**, to tell a Brew token apart. No step of a trade depends
  on it, and each buy would wait on one more read. Rejected; the feed's emitter check gives the
  same answer from the logs.
- **List the multi-pair factories.** Their code is not verified. Rejected until it is.
