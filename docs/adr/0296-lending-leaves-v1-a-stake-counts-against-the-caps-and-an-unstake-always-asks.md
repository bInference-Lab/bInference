# 0296. Lending leaves v1; a stake counts against the caps and an unstake always asks

Status: Accepted

Accepted by the owner on 2026-10-30.

## Context

v1 planned lending on Venus, Lista Lending and Aave v3, with a minimum health factor of 1.5, and
staking through StakeHub and slisBNB. [Decision 0088](../DECISIONS.md#d0088) lets auto mode make
"moves inside the agent's own lending and staking positions" within the caps, and always asks for
withdrawals. No lending venue was built. What exists for lending is shape only:

- the `lend` request of `intent/propose` in protocol v1 (spec 1, section 8.1), which a later version
  of the same protocol may not remove (spec 1, section 9);
- the `lend` kind in the engine's and the signer's auto mode kinds, the `card.lend.*` messages and
  the `health_factor` policy reason;
- `defaults.limits.minHealthFactor` in config and `limits.min_health_factor_bp` in the engine
  database.

A loan can be liquidated by a price move while no one taps anything, and a lending market adds its
own risks, its price feeds and its bad debt, to the agent's. On 2026-10-29 the owner took lending
and loans out of v1 to keep v1's money risk smaller. Staking stays: native BNB staking through
StakeHub, and slisBNB through Lista.

The same day the owner settled how staking moves count and when they ask:

- a stake counts its USD value against the per-trade and 24-hour caps; an unstake and a claim count
  against neither;
- a stake within the caps and a claim may run in auto mode; an unstake always opens a card, since
  it locks the funds for the unbonding time.

Decision 0088 does not say which staking moves are "moves inside the agent's own positions" and
which are withdrawals; this record says it.

## Decision

- **No lending in v1.** binference supplies, withdraws, borrows and repays on no venue. Venus, Lista
  Lending and Aave are not venues of v1, and nothing holds a health factor. The agent has no
  `lend`, `lending_markets` or `lending_position` tool, and no `lending-safety` skill. Lista stays
  a venue for slisBNB alone.
- **Protocol v1 keeps the `lend` shape and refuses it.** Removing a request kind changes v1's
  meaning, so v1 keeps the `lend` request, and the engine answers every one with the new error
  `intent.kind_unavailable` before it stores anything. The next protocol version drops the kind.
- **One code change removes the rest:** `lend` from the engine's and the signer's auto mode kinds,
  the `card.lend.*` messages, the `health_factor` reason and the bundled skill's line that names
  it, `defaults.limits.minHealthFactor` with a config migration that drops it, and
  `limits.min_health_factor_bp` with a store migration, and then the glossary's lending terms,
  which check the old messages until they go. Until it lands, those parts have no effect.
- **A stake counts; an unstake and a claim do not.** A stake counts its USD value, priced as
  [decision 0059](../DECISIONS.md#d0059) prices BNB, against the agent's per-trade and rolling
  24-hour caps, and is refused over either, as a trade is. It never spends the gas reserve. An
  unstake and a claim count against neither cap: what they move stays the agent's and comes back
  to its own wallet. Every staking move credits only the agent's own wallet.
- **Auto mode.** Amends decision 0088: the moves inside the agent's own staking positions that
  auto mode may make are a stake within the caps and a claim. An unstake counts as a withdrawal and
  always opens a card, with the auto mode's reason `unstake`.

## Consequences

- Decision 0088's status is "Amended by 0296". ARCHITECTURE.md, the
  glossary, ENGINEERING.md, the README and specs 1, 2, 3, 4, 6 and 8 drop lending in the same
  change as this record.
- The ceiling's 24-hour sum of native value counts a stake too, since a stake sends BNB; an unstake
  and a claim send none. A day of stakes can fill the ceiling's cap as a day of trades can.
- An agent whose stakes fill its rolling 24-hour cap trades nothing more until the window frees
  room; an unstake gives nothing back to the cap.
- A claim is the only staking move with no card in auto mode and no cap: it can only pay the
  agent's own wallet, which the ceiling's rule for each staking function binds.
- The protocol carries one dead request kind until its next version, and clients must not offer
  it.

## Alternatives

- **Keep lending behind a switch, off by default.** Its code, ceiling rules, cards and tests would
  still need building, reviewing and keeping green for a feature no owner can turn on.
- **Raise the protocol version now to drop `lend`.** Every client would move to a new version for
  one kind no engine ever served; the next version drops it with whatever else changes.
- **Count an unstake and a claim against the caps.** They move nothing out of the agent's
  wallets, so counting them would only stop the owner from getting funds back.
- **Let auto mode unstake.** The funds would stay locked for the unbonding time with no tap, and a
  stolen engine key could keep the owner's BNB out of reach for that long.
