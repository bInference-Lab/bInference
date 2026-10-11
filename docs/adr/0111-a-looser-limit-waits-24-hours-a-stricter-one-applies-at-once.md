# 0111. A looser limit waits 24 hours, a stricter one applies at once

Status: Amended by 0149

## Context

`limit/set` takes any change of an agent's limits and needs `confirm` when every change is
stricter, `loosen` otherwise ([spec 1, section 7.6](../specs/protocol.md#section-7-6)). The spec
named some stricter changes (a lower cap, a lower slippage, a smaller allow list, a larger deny
list, a higher health factor, a larger gas reserve) and said no limit moves past the ceiling, but
not what a change that is neither means, nor how a loosening is guarded. A looser send level waits
24 hours ([decision 0089](../DECISIONS.md#d0089)). The owner decided on 2026-10-09.

## Decision

- A change of one limit is stricter only when clearly so: a cap, a rate or a time lower (the
  per-trade and 24-hour caps, slippage, price impact, tax, the model budget, the copy trade caps,
  how long a card waits, when and how far a card re-quotes, how long an auto order lasts); the
  liquidity floor or the lowest health factor higher; fewer venues; an allow list that keeps only
  tokens it listed and is not empty, since an empty one allows every token; a deny list that keeps
  every token it listed; a gas reserve at least as large on every chain. Every other change is a
  loosening.
- A stricter change, or a change back to the value in effect, applies at once and drops any looser
  value of that limit that waits. A loosening waits 24 hours, is announced on every surface and can
  be cancelled with `limit/cancelPending` and `confirm`; the cancel is announced too. Asking again
  for the looser values that wait keeps their time; any other loosening starts the 24 hours again
  for every limit that waits.
- One call may do both: its stricter changes apply at once and its looser ones wait.
- A gas reserve in `limit/set` names only the chains whose reserve changes.
- The ceiling and the policy's `ceiling` rule stay the hard bound. `limit.over_ceiling` refuses a
  venue added to the limits while a live wallet's ceiling, as last read back from custody, names
  some registry contract of the venue nowhere: only the owner key adds it. A venue or chain the
  registry does not hold is `protocol.bad_args`.
- `notice.limitChange` names one limit and when it changes: "Limit changed by {surface}: {limit}
  changed now", or "... {limit} changes at {when}. Not you? Cancel now." A move of three limits
  sends three notices. `notice.limitChangeCancelled` names a looser limit that is gone before its
  time. `{limit}` is the limit's field in `limit/set`, which each language renders as words.
- Looser limits apply at their time without a write: every engine part reads an agent's limits as
  they are in effect at that moment, so no timer has to run for them.

## Consequences

- `limit/get`, `limit/set` and `limit/cancelPending` answer the limits in effect and the ones that
  wait with their time: an optional field of `LimitsView` and a new operation, both additions
  inside protocol version 1.
- The store keeps the limits that wait in `pending_limits`, beside `limits`; the next move of the
  limits after their time writes them into `limits`.
- An owner who loosens a limit sees it apply a day later, never earlier, and a loosening from a
  hijacked surface shows on every surface for a day before it applies.

## Alternatives

- **Apply every limit change at once.** A hijacked Mini App could raise every cap in one tap.
  Rejected.
- **Make a mixed call wait whole.** A braking change would wait a day with it. Rejected.
- **Refuse a change that is neither stricter nor looser.** The owner could not change how long a
  card waits at all. Rejected.
- **Put the old and new values in the notice.** The notice push carries text, times and token
  amounts only; dollars, rates and token lists would need new formats on every surface. The owner
  reads the values with `limit/get`. Rejected for now.
