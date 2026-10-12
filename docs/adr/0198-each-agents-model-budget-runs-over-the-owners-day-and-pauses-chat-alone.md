# 0198. Each agent's model budget runs over the owner's day and pauses chat alone

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[ARCHITECTURE.md section 26](../ARCHITECTURE.md#section-26) gives each agent a daily model budget,
$3 by default, and [spec 8](../specs/runtime.md) section 8.3 has `turn/start` refuse a turn once
it is spent, with `details.resumesAt`, the owner's next midnight. [Decision 0191](0191-each-model-attempt-is-priced-and-recorded-and-a-loop-tells-the-owner.md)
has the runtime record each attempt of a model call under the key `<turn>.usage.<n>`. They leave
open:

- **The day.** Midnight where, and on a day the clocks change.
- **Once per attempt.** The server keeps a write's result per credential and key, but a runtime
  that restarts signs in with a new token, so a record sent again from it would count twice.
- **Who stores the usage.** `ModelBilling` says what an agent may spend; nothing stores the
  attempts that `usage/get` and `/spend` read.
- **The status line.** Section 8.3 has the engine push it, spec 4 has the runtime send every status
  line with `turn/status`, and decision 0191 shows none for a budget spent mid-turn, since only
  the engine knew when it resumes.
- **Telling the owner once a day,** across a restart of the engine.
- **The range of `usage/get`.**

## Decision

- **The owner's day.** The budget runs from midnight to midnight in `owner.timezone`, read at each
  call. A day is 23 or 25 hours long across a change of the clocks; where the clocks skip midnight,
  the day starts at the first moment of its date, such as 01:00.
- **Each attempt once.** A handler's call carries the write's key as its client sent it.
  `model_usage` keeps `key` unique, and an attempt sent again under its key keeps the first cost
  and charges nothing.
- **The daily model budget is the billing an owner's own key needs.** Its charge stores the
  attempt, and what is left is the agent's budget in effect now less the stored spend of the
  owner's day, never below 0. A billing the composition root gives in its place, such as AI credit,
  stores the attempts itself.
- **Refusing a turn.** `turn/start` checks the agent first, then the budget: once nothing is left
  it refuses with `agent.budget`, not retryable, and `details.resumesAt`, the owner's next
  midnight. `usage/record` answers `resumesAt` beside a budget left of 0.
- **The notice.** `notice.budget` goes once per agent and owner's day, whichever comes first: the
  refused start or the record that spent the budget. The day is claimed in `budget_notices` before
  the notice is sent, so a restart never sends it twice.
- **The status line.** The runtime sends `turn.budget` with `{ when }`, the resume time, as it sends
  every status line: for a start the engine refused, and at the end of a turn that ended `budget`.
  Each message the owner sends while chat is paused tries a start, so each gets the line.
- **Only chat waits.** Orders, watchers and alerts never read the budget: they are code.
- **`usage/get`** answers the range from `from` up to `to`, at most 92 days, cut into the owner's
  days, by agent and model, with the budget of the agent named, or of every agent not archived.

## Consequences

- Migration 0033 makes `model_usage` again with `key` and adds `budget_notices`. Spec 3, spec 1
  section 7.7 and spec 8 section 8.3 say so.
- Decision 0191 is amended: a turn spent mid-way shows the status line, and `usage/record` charges.
- `/spend` reads `usage/get` for today and the month.
- An AI credit billing resumes when credit is bought, not at midnight; when that billing is
  composed, it names its own resume time.

## Alternatives

- **A rolling 24 hours.** The owner reads "today's budget" and expects it back at midnight.
  Rejected.
- **Count once by the server's idempotency alone.** A runtime restarted with a new token would count
  an attempt twice. Rejected.
- **The engine pushes the status line.** Two writers of the turn's lines, and the engine would draw
  a line for a turn it never started. Rejected.
- **A notice for each refused start.** The owner would be told again at every message. Rejected.
- **Keep the day of the notice in memory.** Each restart of the engine would tell the owner again.
  Rejected.
