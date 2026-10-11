# 0166. A Mini App launch may be dated at most 1 minute ahead of the engine

Status: Accepted

Accepted by the owner on 2026-10-11.

Amends [decision 0161](0161-a-mini-app-launch-needs-a-one-time-ticket-from-console-and-lasts-12-hours.md),
which kept the clock window of
[decision 0160](0160-a-mini-app-launch-signs-in-once-and-a-new-owner-ends-the-old-one-s-mini-app.md).

## Context

[Decision 0160](0160-a-mini-app-launch-signs-in-once-and-a-new-owner-ends-the-old-one-s-mini-app.md)
accepts a Mini App launch whose `auth_date` lies at most 5 minutes before or after the engine's
time, so an engine whose clock lags Telegram's still signs the owner in;
[decision 0161](0161-a-mini-app-launch-needs-a-one-time-ticket-from-console-and-lasts-12-hours.md)
left that window as it was. Telegram's Mini App documentation advises a server to check
`auth_date` to refuse outdated data. Telegram writes `auth_date` from its own clock,
so a fresh launch can be dated after the engine's time only by the skew between the two clocks.
A machine whose clock follows network time is within a second of Telegram's. Accepting 5 minutes
ahead does not serve a real launch; it stretches how long the engine could take a launch dated by
a clock that is wrong, and a check on freshness should not accept the future more than the skew
needs.

## Decision

- **`auth_date` may lie at most 5 minutes before the engine's time, as before, and at most
  1 minute after it.** A launch dated further ahead is refused like one too old: `bye
auth.expired`.
- Decision 0160 stays as written for everything else, and so does decision 0161.

## Consequences

- A launch is accepted for at most 6 minutes around its date instead of 10.
- An engine whose clock runs more than 1 minute behind Telegram's refuses every Mini App launch
  until the machine's clock is set right; opening the Mini App again does not help. The engine's
  other checks that use time, such as card and token expiry, already need a correct clock.

## Alternatives

- **Keep 5 minutes ahead.** It changes nothing for a correct clock and keeps the wider window for
  a wrong one. Rejected.
- **Refuse any `auth_date` after the engine's time.** `auth_date` is in whole seconds and two
  correct clocks still differ by a little, so a fresh launch could be refused. Rejected, as
  decision 0160 found.
- **A new refusal code for a launch from the future.** The console would show the owner the same
  advice, to open the Mini App again, so a separate code adds nothing. Rejected.
