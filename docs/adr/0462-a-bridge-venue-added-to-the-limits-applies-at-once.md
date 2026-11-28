# 0462. A bridge venue added to the limits applies at once

Status: Accepted

Accepted by the lead on 2026-11-28. Proposed on the owner's ruling of 2026-11-28: "remove that safety rule for bridges, make it
enabled by default".

## Context

[Decision 0111](0111-a-looser-limit-waits-24-hours-a-stricter-one-applies-at-once.md) makes every
loosening of an agent's limits wait 24 hours, and a venue added to `limits.venues` is a loosening.
The wait lets the owner see and cancel a loosening a hijacked surface asked for before it applies.
For a bridge venue it guards little: a live agent adds a venue only while every live wallet's
ceiling already holds its contracts (`limit.over_ceiling`, decision 0111), and a bridge venue only
a bridge wallet uses only while that wallet's ceiling holds its deposits (`limit.bridge_ceiling`,
[decision 0307](0307-a-bridge-wallet-holds-only-its-own-deposits-and-runs-every-route-only-it-may-pay.md)).
Only the owner key writes a ceiling. A bridge's deposit pays only addresses saved with the owner
key and the rescue address ([decisions 0302](../DECISIONS.md#d0302) and
[0313](../DECISIONS.md#d0313)), or, for Relay, only what the owner put in the bridge wallet. So
the wait adds a day to every first bridge and bounds nothing the ceiling does not.

## Decision

- A bridge venue is a venue the engine bridges with, such as Across or Relay, or one only a bridge
  wallet uses (decision 0307).
- A change of `limits.venues` whose every added venue is a bridge venue applies at once. It still
  needs `loosen`, as any loosening does, and it is still journaled, pushed and announced as
  `notice.limitChange` with no time. It still needs every live wallet's ceiling to hold the venue
  (`limit.over_ceiling`, `limit.bridge_ceiling`).
- A change that adds any other venue waits 24 hours whole, its bridge venues with it. Every other
  limit keeps decision 0111's rule; one call may apply its venues at once and leave another
  loosening waiting.
- A venues change that waits from before this release only because it adds a bridge venue
  applies when the owner asks for the same venues again with `limit set`.

## Consequences

- A new agent that names a bridge, or an owner who adds one after the owner key wrote it into the
  ceiling, bridges the same minute.
- A hijacked surface that holds `loosen` can add a bridge venue at once, with no day for the owner
  to cancel it. What it gains is bounded by the ceilings: it can only bridge to addresses the owner
  saved with the owner key, or from the bridge wallet's own funds. The notice still goes to every
  surface, and `limit set` with fewer venues takes it back at once.
- `moveLimits` takes which venues are bridge venues and answers the looser limits that applied at
  once; its property test holds that only the venues apply early, and only when every venue added
  is a bridge venue.

## Alternatives

- **Keep the wait for bridges.** Against the owner's ruling: every first bridge waits a day.
- **Apply every added venue at once.** A venue that swaps trades the agent's funds on contracts the
  owner key let in, but a new swap venue can change prices and routes the owner expects; the day
  stays for those.
- **Need only `confirm` for a bridge venue.** Every loosening needs `loosen` today, and a surface
  with only `confirm` (the Telegram fast commands) never loosened anything. Kept as it is.
