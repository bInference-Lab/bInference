# 0231. A schedule runs on five cron fields on the owner's wall clock

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

[ARCHITECTURE.md section 26](../ARCHITECTURE.md#section-26) has schedules run in the owner's
timezone, and `schedule/create` takes `{ cron, timezone? } | { at }`
([spec 1, section 7.5](../specs/protocol.md#section-7-5)). `owner.timezone` reloads live
([decision 0118](0118-settings-reload-when-config-json5-changes.md)). The specs leave open:

- **The cron dialect.** Dialects differ in fields, names, macros and how a month day and a weekday
  combine.
- **A change of the clocks.** A wall time such as 02:30 does not exist on the night the clocks
  jump forward, and 01:30 occurs twice on the night they go back.
- **A change of `owner.timezone`.** A schedule that names no zone of its own follows it.
- **How the next run is worked out.** The engine is a pure package and reads time only through
  its `Clock`.

## Decision

- **Five fields.** `minute hour day month weekday`, each a number, `*`, a list, a range or a step
  (`*/15`, `1-30/2`, `5/20`); months and weekdays may be three-letter English names, in any case;
  weekday 7 is Sunday. A sixth field, `@daily` and other macros are refused with
  `schedule.bad_when`. When both the month day and the weekday fields name days, a day matches
  either; when one of them starts with `*`, a day must match both.
- **The zone.** A cron schedule runs on the wall clock of its own `timezone`, or of
  `owner.timezone` when it names none. A one-time schedule runs at its `at`, an instant, in any
  zone.
- **A wall time the clocks skip** runs at the moment they jump past it: on the night 02:00 becomes
  03:00, a 02:30 run starts at 03:00. Every skipped wall time of that night runs once, at the jump.
- **A wall time the clocks show twice** runs once, at its first occurrence.
- **A change of `owner.timezone`** moves the next run of every active schedule that names no zone
  of its own into the new zone, from the moment the queue sees the change. It never runs a schedule
  at once.
- **Refusals.** An expression or zone binference cannot read, an `at` that is not ahead, and an
  expression with no run in the next eight years (such as 31 February) are `schedule.bad_when`.
- **Our own evaluator.** The engine works out the next run from the parsed fields and the wall
  clock that `@binference/i18n` reads through `Intl`, so it needs no new dependency and runs in
  the pure engine under its fake `Clock`.

## Consequences

- The wall-time rules are tested on New York's changes of the clocks in 2027 with a fake clock.
- A schedule stores the zone its next run was worked out in (`schedules.zone`), so a change of
  `owner.timezone` while the engine was off is seen at its next start.
- A schedule every 30 minutes skips the repeated half hours of the night the clocks go back, as
  every fixed wall time does.
- Spec 1 section 7.5 and spec 3 section 2.4 say so.

## Alternatives

- **A cron library.** Adds a dependency to a money package for about 150 lines of logic, and the
  common libraries need their own rules on top for skipped and repeated wall times. Rejected.
- **Skip a run whose wall time does not exist.** An owner who set 02:30 would lose one run a year
  with no word. Rejected.
- **Run a repeated wall time twice.** The owner set one run at 01:30 and would get two turns, and
  two charges against the model budget. Rejected.
- **Six fields with seconds, or macros.** A turn of the model has no use for seconds, and macros
  are a second way to write the same thing. Rejected.
