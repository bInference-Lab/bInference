# 0311. A confirmed intent that ended failed_check frees its daily cap

Status: Accepted

Accepted by the owner on 2026-11-01 ("Stop counting").

Amends [decision 0136](../DECISIONS.md#d0136).

## Context

[Decision 0136](0136-the-24-hour-cap-counts-each-confirmation-at-its-judged-value.md) counts every
confirmation against the rolling 24-hour cap, except an intent that ended without moving anything:
`cancelled`, `expired` or `failed_onchain`. Since then, three ends move a confirmed intent to
`failed_check` before anything is signed:

- a launch wallet's curve trade whose launch its launchpad cannot read, or that left its curve, as
  the wallet queue takes it (`launch_unread`, `launch_moved`,
  [decision 0218](../DECISIONS.md#d0218));
- a paper sale or swap whose paper portfolio holds less of its input at the fill
  (`nothing_to_sell`);
- a send by name whose name moved before the queue took it (`name_moved`,
  [decision 0308](../DECISIONS.md#d0308)).

Each still counted for a day. An owner whose launch trade or paper sale never went out found later
trades refused with `daily_cap`, and anyone who controls a name the agent pays could fill the cap
with sends that never left.

## Decision

- A confirmed intent that ended `failed_check` does not count against the rolling 24-hour cap, like
  `cancelled`, `expired` and `failed_onchain`. Nothing of it was signed, so it moved nothing.
- A late landing never applies to it, since it has no transaction.

## Consequences

- The cap counts only what was signed and may still move, or did move.
- The list of states in `isCounted` and spec 6, section 9, gain `failed_check`.

## Alternatives

- **Count it for its day, as before.** It refuses trades the owner could afford, after an intent
  that moved nothing. Lost.
- **Leave out only `name_moved`.** The launch and paper ends have the same fault. Lost.
