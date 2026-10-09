# 0114. A paper sale no simulation can hold is an estimate

Status: Accepted

## Context

A paper intent simulates with its paper balances, which the chain's simulator sets in the
token's storage. A token that computes its balances, such as a reflection or rebasing token, keeps
them in no slot a simulation can set, so a paper sale of it reverted in the simulation and the
intent failed its check, though the owner holds the token on paper.

## Decision

In paper mode only, a sale of a token whose balance the chain's simulator cannot set runs no
simulation: the simulator refuses with `chain.balance_unset`, and the paper simulation passes the
sale as an estimate at the quote's amounts. The intent's simulation is marked estimated, and its
card drops the check line and says that the paper fill uses the quote
(`card.warn.paperEstimate`, in English and Chinese). A live trade always needs its simulation.

Accepted by the owner on 2026-10-09.

## Consequences

- The `TxSimulator` port refuses a token balance it cannot set instead of keeping the holder's
  balance on the chain; its contract suite checks it.
- The protocol's simulation view gains the optional field `estimated`.
- A buy paid with such a token cannot fund the risk step's round trip, which then counts as unable
  to run (decision 0112).

## Alternatives

- **Keep failing the check.** A paper agent could never sell a reflection token it holds.
  Rejected.
- **Estimate live sales too.** A live trade would run without a simulation. Rejected.
