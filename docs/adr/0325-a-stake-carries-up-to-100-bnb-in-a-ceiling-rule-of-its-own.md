# 0325. A stake carries up to 100 BNB in a ceiling rule of its own

Status: Amended by 0332

Accepted by the owner on 2026-11-01 ("Staking up to 100 BNB").

## Context

[Decision 0094](../DECISIONS.md#d0094) set the Privy ceiling's cap per transaction to 1 BNB
(`defaults.ceiling.perTxBnb`), and [decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md)
puts it on every call rule as `value lte` the cap. StakeHub's least stake is 1 BNB, so a stake of
more than 1 BNB gets a card and then dies at Privy, and a least raised above the cap refuses every
stake. [Decision 0302](0302-a-bridge-deposit-binds-its-depositor-recipient-chain-and-tokens-in-one-rule-per-route.md)
already gives a bridge deposit rules of its own; a plain call has none.

Privy's policy engine allows a transaction when one rule's conditions all hold, and each rule
names its own `value` condition, so one rule's cap does not reach another's. A `delegate` credits
only the wallet that signs: StakeHub takes no beneficiary in it.
On 2026-11-01 the owner ruled: staking up to 100 BNB.

## Decision

- **A cap of a call's own.** A venue may declare `maxValueBase` on a plain call it builds. The
  chain registry declares it on StakeHub's `delegate` alone: 100 BNB. The StakeHub plugin declares
  the same, and the composition root's test checks the two agree.
- **Its own rule.** The ceiling planner gives such a call the rule
  `Call <function>, own cap, chain <id>`: the function on its contracts, `value lte` its own cap
  whatever `perTxBnb` is, its pinned inputs, and the chain's 24-hour native cap. Every other call
  keeps `value lte` the cap per call. Two calls of one function with different caps are refused as
  clashing, so no other contract's function of the same name gets the stake's cap.
- **The read-back.** It takes the chain's cap per call from the first call rule without a cap of
  its own, and each own-cap rule's cap from that rule, so a ceiling reads back as built.
- **The caps still bound it.** A stake counts against the install-wide 24-hour BNB cap of the
  ceiling, and the engine's per-trade and rolling 24-hour caps still apply ([decision 0296](0296-lending-leaves-v1-a-stake-counts-against-the-caps-and-an-unstake-always-asks.md)).

## Consequences

- Wallets whose ceilings hold StakeHub's calls carry the own-cap rule once their ceiling is
  written again with the owner key; until then a stake above `perTxBnb` still dies at Privy, which
  the engine refuses before the card (next task).
- A thief who holds every key can stake up to 100 BNB a call with a validator he runs, inside the
  24-hour native cap: the stake stays the wallet's, and an unstake brings it back after the
  unbonding time.
- Native sends to the rescue and saved addresses keep no cap per transaction, as before: a rescue
  moves whole balances.
- The custody suite's 24-hour native cap grows from 100 BNB to 1,000 BNB, so its 100 BNB stake
  leaves room for its other checks.

## Alternatives

- **Raise `perTxBnb` for staking.** It would raise every call's cap, a swap's and a launch call's
  among them.
- **Split a large stake into 1 BNB calls.** Each call is a card and a fee, and a least stake above
  the cap would still refuse every stake.
- **Read the stake's cap from the per-transaction cap times a factor.** The owner named a figure,
  not a ratio, and a factor would move with a setting made for other calls.
