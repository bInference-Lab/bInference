# 0270. A launch's first buy may carry no minimum when it runs inside the create call

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0235](0235-a-launch-card-shows-every-setting-its-terms-hash-binds.md) has the venue host
refuse a launch whose create call buys its first buy below the minimum: the launchpad's quoted
output less the agent's maximum slippage (`low_min_out`). The launcher contract checks the same.

Flap's Portal makes a token and runs its first buy in one call (`newTokenV6`, with `quoteAmt`), and
the call takes no minimum for that buy. Read on BNB Smart Chain on 2026-10-20 (Portal v5.25.0):

- The first buy runs inside the call that creates the token and its curve. No other trade can
  reach the curve before it, so no one can move its price between the quote and the buy.
- What it gets depends only on the Portal's own settings at that block: the curve of the pair, the
  1% curve fee and the token's buy tax. A simulation of the call gives it to the base unit.
- The Portal is an upgradeable proxy whose owner can change those settings, as it can change
  anything the Portal does.

A minimum out exists against other traders. Here only the launchpad's owner could lower the first
buy, by a change to the Portal between the simulation and the block.

## Decision

- **A launcher declares it.** A launcher may declare `noFirstBuyMin`: its create call's first buy
  runs inside that call and carries no minimum. Its decoder then reads the first buy's minimum as
  0, and the launcher contract checks that it does, so a decoder never names a minimum the bytes
  do not hold.
- **The host accepts it only from such a launcher of a listed launchpad.** The minimum check of
  decision 0235 passes a create call with no minimum only when its launcher declares
  `noFirstBuyMin` and the chain registry lists its launchpad as one whose create call runs the
  first buy so: on BSC, Flap alone (`bscUnboundFirstBuys`). A launcher's own word is not enough, so
  no plugin claims the exception without a change of the registry. From any other launcher the
  check stays `low_min_out`.
- **The simulation binds it.** The simulation before the card still requires the launch wallet to
  receive at least the first buy's minimum of the new token (decision 0234). The launch's quote
  stores `isUnbound` with its first buy, so the terms hash covers it.
- **The card says so.** Such a launch's card shows `card.warn.unboundFirstBuy` in both languages.
- Every other check holds: the exact spend, the recipient, the fee, the settings, the token's
  address, the registry contracts, and the alarm when a settled trade lands more than 1% from its
  simulation.
- **The owner's ruling.** On 2026-10-20 the owner accepted this as built: the first buy in the
  create call with no minimum, held by the simulation before the card, with the card's warning.

## Consequences

- Flap launches with a first buy pass the money path, and a first buy that lands lower than the
  card showed raises the reconcile alarm.
- Between the simulation and the block, a change of the Portal's own settings by its owner could
  lower the first buy, and nothing on chain stops it. That owner can already change every call the
  Portal runs, which the simulation before each card guards in the same way.
- `Launcher` gains `noFirstBuyMin`, the launch host takes the registry's list of such launchpads
  on each chain, `LaunchPlan` gains `isFirstBuyUnbound`, the stored launch
  quote's first buy gains `isUnbound`, and the card gains `card.warn.unboundFirstBuy`. Spec 4
  section 3.3 and spec 6 section 3 say so.

## Alternatives

- **Buy as a second step through `swapExactInput`, with a minimum.** Bots watch for new Flap
  tokens and can buy between the two transactions, and the launch plan allows one create call
  last. Rejected.
- **Launch without a first buy on Flap.** The owner would lose the first buy at the start price.
  Rejected.
- **Have the decoder compute a minimum from the curve.** The bytes hold no minimum, and the Portal
  would not enforce the computed one. Rejected.
