# 0331. A liquid staking venue stakes into one pool, and its queue says when a claim is ready

Status: Accepted

Accepted by the owner on 2026-11-02.

## Context

The `StakingVenue` port ([decision 0324](0324-stakehub-is-read-and-called-on-chain-and-every-move-credits-only-the-caller.md))
was shaped around StakeHub: every move names a validator, the receipt token is a validator's credit
shares, which refuse transfer, an unstake names coin, every move is one call, and an unstake's coin
is ready at a time the chain sets from the landing block. Spec 1 already lets a `stake` request on
Lista name no validator and name an unstake in slisBNB, and the database spec lets an unbonding row
belong to a venue with no validator.

A liquid staking venue differs on each point. Lista's stake manager takes BNB and mints slisBNB, a
plain ERC-20 the wallet holds and can move. Its `requestWithdraw` names slisBNB units and pulls them
with `safeTransferFrom`, so it needs an approval first. Its `deposit` takes no least amount out. A
request waits in Lista's own queue until Lista's bot has unbonded enough BNB on StakeHub: Lista's
developer docs say the wait is 7 days and to read `getUserRequestStatus` rather than assume a
deadline. Its claim takes one request per call.

## Decision

- **One pool, no validators.** A venue may declare `pool`, one account on its chain. Its
  `options` list the pool alone, and every request, plan, decode and read-back names the pool where
  a validator stands. A protocol request on such a venue names no validator, and the engine fills
  the pool, and `staking/options` marks the pool's row `pool: true`. One that names a validator,
  or an unstake there that names the chain's coin, is `intent.pool_venue`, whose words say to
  propose it again with no validator and in the receipt token; a request on a venue of validators
  that names none is `protocol.bad_args`. A request with no amount, such as a claim, finds its
  chain from the only chain the engine runs the venue on. A refusal before any plan keeps the
  pool, by the name the venue's options give it, so its words name it.
- **An unstake in receipt units.** On a liquid venue an unstake names its amount in the receipt
  token, exactly that many units, or the whole holding; the host refuses a plan that burns another
  number of units (`short_unstake`). Its coin out is what the pool converts them to at the plan's
  block.
- **An exact approval before the unstake.** A liquid venue's unstake builds two calls: an approval
  of exactly the plan's receipt units to a spender the venue declares, then the request. The host
  reads the approval through the chain's family and refuses any other approval (`other_approval`),
  any other order of calls (`step_order`) and an approval before any other move. The simulation
  lets an unstake set an allowance of the receipt token only to those units or to zero, only to a
  spender the venue declares, and move out of the wallet no more receipt units than it burns; the
  signer allows the venue's declared spenders for such an unstake alone. The request spends the
  allowance, so none is left once it lands. When the approval landed and the request then
  reverted, was cancelled or was never signed, the exact approval stands: only the wallet's own
  request can spend it, so `notice.stakeApprovalLeft` tells the owner and nothing resets it, as a
  launch's leftover approval is told ([decision 0289](0289-a-launch-that-ends-unsigned-tells-the-owner-in-its-own-words.md)).
- **A stake's least units.** A plan may carry `minShares`, the least receipt units a stake mints
  when it lands, which its card promises (`card.stake.liquid`). The simulation holds the units it
  mints to at least those. The queue's new plan of the stake ends the move `decode_mismatch` when
  it would mint fewer, with that reason's words: what would be signed no longer matches the card.
  A venue whose stake takes no least amount on chain can still mint fewer when its rate moves
  between that plan and the landing: such a read-back is booked as it landed, and
  `notice.stakeMintedFewer` tells the owner what it minted against what the card promised. A
  read-back that minted none is `other_shares`.
- **The queue says when.** An unstake's ready time on the card and in its row is the earliest
  one: the plan's time, or the landing block's, plus the unbonding time the venue reads. A part the
  queue has not released reads as `queued`, ready no sooner than a millisecond after its read, so
  the host refuses its claim (`unready_part`) and the venue answers `nothing_to_claim` with that
  time. `notice.claimReady` tells the owner of a live part of a liquid venue only once the venue
  reads it as released, and the unstake's card says the venue's queue may release it later
  (`card.stake.liquidQueue`). The portfolio and the daily summary count such a part claimable
  only once it was told released.
- **A paper claim names no request.** A paper part is no request on the chain, so a liquid
  venue's paper claim builds a call, never sent, that names request 0, which no request holds.
- **One request per claim.** A liquid venue's claim takes the oldest request its queue released,
  by the venue's own id of that request, and names it in the plan's `parts`. Its decoded call names
  that id too (`DecodedStake.refs`), which the host holds to the plan's parts. When the queue takes
  the claim, the card's request must still be among the parts the venue reads, else the claim ends
  `nothing_to_claim` with nothing signed. A second ready request waits for a second claim.
- **Its words.** A liquid venue's cards say `card.stake.liquid`, `card.stake.unstakeLiquid` and
  `card.stake.claimLiquid` with the venue's name, show no validator or commission line, and show
  the unstaked amount in receipt units. The stored quote marks such a move `liquid`, so the card
  reads it from what its terms hash binds.

- **Lista's id is `lista`.** Spec 1 and the database spec named the venue `slisbnb`; the venue id
  is the plugin's name and the registry's venue of Lista's contracts, so both now say `lista`.
  `staking/options` lists Lista's pool as one row of the shape StakeHub's validators have, in
  place of spec 1's `rate` row: slisBNB's rate is its price.

## Consequences

- StakeHub keeps its shape and its behaviour: no pool, no approval, coin amounts.
- The port's contract suite runs every check on both kinds; a liquid fake joins the validator fake
  in `@binference/chain/testing`.
- A paper liquid unstake waits the unbonding time from its fill, as a paper StakeHub unstake does.
- An owner with two ready requests claims twice; each claim is a card, or no card in auto mode.
- A receipt token that is a plain ERC-20 stays a priced token where the registry prices it, as
  slisBNB is ([decision 0328](0328-slisbnb-is-worth-bnb-s-feed-price-times-its-stake-manager-s-rate-within-bounds.md)).

## Alternatives

- **Make the validator optional across the port.** Every check, row and view that pairs a move with
  its validator would need a second path; naming the pool keeps one path and the database spec's
  rule that a row knows where its coin waits.
- **Approve the receipt token without a limit once.** A stolen key could then hand every future
  slisBNB to the pool's spender function without a card.
- **Claim every ready request in one intent of several calls.** The executor, the read-back and the
  booking hold one call per staking move; a partial landing would need a new state.
- **Show the earliest time as the ready time with no word on the queue.** The owner would be told a
  claim can be made when the venue still refuses it.
