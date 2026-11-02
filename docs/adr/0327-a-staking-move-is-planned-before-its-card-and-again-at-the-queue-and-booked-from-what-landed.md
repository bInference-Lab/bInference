# 0327. A staking move is planned before its card and again at the queue, and booked from what landed

Status: Accepted

Accepted by the owner on 2026-11-01.

## Context

[Decision 0296](0296-lending-leaves-v1-a-stake-counts-against-the-caps-and-an-unstake-always-asks.md)
set the rules for a `stake` intent: a stake counts against the per-trade and 24-hour caps, an
unstake and a claim against neither, an unstake always asks, and paper stakes wait out unbonding.
[Decision 0324](0324-stakehub-is-read-and-called-on-chain-and-every-move-credits-only-the-caller.md)
gives the `StakingVenue` port a `plan`, a `build`, a `decode` and a `landed` read, and
[decision 0325](0325-a-stake-carries-up-to-100-bnb-in-a-ceiling-rule-of-its-own.md) lets a stake
carry up to 100 BNB in a ceiling rule of its own. The engine still needs to choose where a move
is planned, what the card's terms hash binds, how the caps treat a move worth nothing, what the
simulation holds, and what the ledger books. The specs are silent on each.

## Decision

- **Plan before the card.** The engine asks the venue to plan the move before any card. A refusal
  ends the intent before the card with the venue's check reason; a jailed validator ends
  `rejected_policy` with `validator_jailed`, after every policy rule spec 6 lists before it. A
  refusal keeps the facts its words name, the venue's least stake and when the next part is ready,
  in the event that ends the intent, so every surface shows them with the validator. The intent
  stores the plan as its quote, so the card's terms hash binds it.
- **The yearly rate is part of the plan.** For a stake, the venue reads the rate of the chosen
  validator alone, from its last two days of rewards, in the plan: four reads, never every
  validator. A rate above 10,000% a year is left out, and the plan's schema holds it between 0
  and that bound, so a rate outside it never reaches a card.
- **The host holds the venue.** The venue host is the only caller of the venue and copies all it
  returns through schemas. It holds the plan to the request (`other_plan` for another action,
  wallet, validator, mode or coin, and `short_unstake` for an unstake that takes out less than its
  amount), the plan's units to the validator's receipt token (`other_receipt`), a claim's parts to
  the wallet's own parts ready by the plan's time (`unready_part`, read from the paper rows or the
  venue's holdings), and the built call to the plan through `decode` (`other_stake`, or the
  existing mismatches for another sender, an undeclared contract or a recipient). Each is a
  `decode_mismatch` with its check named. A validator name is 1 to 64 printable characters; it is
  the operator's own words, so a tool result that carries it marks the agent's turn.
- **The caps.** The policy judges a stake by the venue's own cap on its call where the venue declares
  one, in place of the ceiling's cap per transaction. An intent worth nothing passes both caps,
  even on a day whose spending already passed them: an unstake and a claim store no value, and a
  full day must not stop the owner from taking funds back.
- **The ceiling gap.** A wallet whose stored ceiling was written before decision 0325 holds a stake
  to the cap per call. A stake above what the stored ceiling lets one stake carry ends
  `failed_check` with `stake_over_ceiling` before the card, whose words name the owner-key command
  that writes the ceiling again. The engine reads its stored copy only, so the check costs no call
  to custody.
- **Again at the queue.** When the wallet queue takes a confirmed move, the venue plans it again
  before any signature: a validator can be jailed, the venue paused or the stake moved since the
  card. A refusal ends the move `failed_check` with the venue's reason through a new `stake_refused`
  trigger, its facts kept as before the card; a plan of another move than the card's ends it with
  `decode_mismatch`; an unstake of more receipt units than the wallet holds now ends with
  `exceeds_staked`. A venue that does not answer signs nothing and waits for the next block. The
  call signed is the one the card bound.
- **The simulation holds what leaves.** A staking move mints or burns the venue's receipt token,
  whose amount the venue alone can read. The simulation check holds that at most the plan's value
  of the chain's coin leaves the wallet, that nothing else leaves but the plan's receipt units and
  the venue's voting token (StakeHub's govBNB, which an unstake burns, named in the registry), and
  that no approval is set.
- **Booked from what landed.** Reconciliation books a landed move from what the venue reads back of
  its transaction, never from the plan: a stake's receipt units as an execution from coin to
  units, an unstake's coin as a sale of those units into an unbonding row at the coin's price
  then, a claim's parts as an arrival at the value each unstake recorded. The host holds the
  read-back to the confirmed plan (`other_move`, `other_coin`, `other_shares`, `other_request`,
  `other_parts`); a read-back that fails is logged and never booked.
- **Booked once.** Each write is found again before it is made, so a run after a stop books nothing
  twice. An unstake writes its unbonding row before its sale, and a sale booked again takes the
  row's value; with no price the row is stored without one and the sale waits for a price. A claim
  marks the rows it took, then their coin arrives at the value they recorded, and the rest of what
  it took, such as a part unstaked outside binference, arrives with no value. A stake whose dropped
  step lands after all is booked as it lands, each block until its read-back and price are there.
- **Paper.** A paper move is planned by the same venue at the latest block, against the paper
  position: its receipt units and the paper unstakes no claim took. A paper stake books the receipt
  units its plan names; a paper unstake keeps its coin in an unbonding row marked paper, ready at
  its fill time plus the unbonding time; a paper claim takes the rows that are ready. The start
  books every paper staking move a stop left unbooked.
- **The request.** An unstake that names no amount unstakes the whole stake, with the exact amount
  on the card; a claim names none. The port gains `receipt(validator)`, the token a stake with
  that validator mints, so a paper position and the ledger name the same asset.
- **The card and after.** A stake shows the validator's yearly rate as `card.stake.rate` after the
  validator line, and leaves it out when the venue gives none. An unstake's card says it can be
  claimed from the later of the venue's time and the card's expiry plus the unbonding time; its
  receipt, `receipt.unstaked`, names the venue's own time. A check each minute tells the owner once
  per unbonding row that its coin can be claimed (`notice.claimReady`). An unstake in auto mode
  asks with `autoAsks.unstake`.

## Consequences

- A stake, an unstake and a claim run end to end through the engine and its executor, live and on
  paper; the fork suite proves all three on StakeHub with the venue's own yearly rate read.
- A move that was fine at the card but not at the queue ends before it signs, and the owner sees
  the venue's reason with its validator, least stake or ready time.
- A wallet whose ceiling predates decision 0325 refuses stakes above its cap per call before the
  card, until the owner writes the ceiling again.
- The yearly rate costs four reads per stake; a venue that cannot read it leaves the line out.
- A venue whose read-back leaves the plan leaves the move `finalized` and unbooked, with a log line
  naming the check, until recovery reads it again.
- The unbonding table gains `told_ready_at` and an index of rows not yet told; Telegram's positions
  view does not list staking yet.

## Alternatives

- **Plan at the queue only.** The card would show no validator details, unbonding time or yearly
  rate, and the terms hash would bind no plan.
- **Read every validator's rate, or cache the set.** The whole set is 56 validators and about 400
  reads per proposal, at another block than the plan's; a cache would add a time limit and a size
  limit to tune, while the chosen validator's own four reads stay at the plan's block.
- **Hold the receipt token's amount in the simulation.** Only the venue can read how many units a
  move mints or burns; a bound guessed by the engine would refuse good moves or pass bad ones.
- **Book from the plan.** A stake's units move with the validator's exchange rate between the card
  and the block, so the ledger would drift from what the wallet holds.
- **Let a full day's caps stop an unstake.** It would lock the owner's own funds behind a cap made to
  stop spending.
