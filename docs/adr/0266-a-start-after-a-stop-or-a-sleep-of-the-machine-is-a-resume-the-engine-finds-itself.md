# 0266. A start after a stop, or a sleep of the machine, is a resume the engine finds itself

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0066](../DECISIONS.md#d0066) re-checks the orders when the engine resumes after sleep, a
reboot or a crash, and sends the owner one report of how long the engine was off
([spec 4](../specs/cards-and-messages.md), `notice.resumed`). Nothing stores when the engine last
ran: a crash writes nothing as it ends, and a laptop that sleeps stops the engine's timers while
its wall clock goes on, as the nightly backup already finds
([spec 5](../specs/keys-and-backups.md) section 7.3). The specs do not say how the engine tells a
resume, nor how long it was off.

## Decision

- **The engine marks that it runs.** While it serves, it writes the wall clock's time to
  `engine_alive` about once a minute, and once more as it stops. A crash leaves the last mark, a
  minute old at most. Migration 0046 writes the first mark, so the first start after the update
  that adds it re-checks the orders that waited through the update.
- **A start that finds a mark is a resume.** The engine was off from the mark to the start. An
  install with no mark re-checks nothing at its first start. Every later start re-checks, however
  short the stop: an order cannot tell a short stop from a long one.
- **A jump of the wall clock is a pause.** A timer of the composition root sleeps 5 seconds at a
  time through the `Clock` port. A sleeping machine stops the timer, never the wall clock, so a
  wall clock more than the sleep threshold past the timer's sleep
  ([decision 0269](../DECISIONS.md#d0269)) is a pause from the end of that sleep: a sleep of the
  machine, or the clock stepped forward. A wall clock set back more than a second is a pause too,
  of the size of the step.
- **Whoever looks first finds the pause.** The check runs at the next tick, at the next price the
  hand-off sees, and at every question to the engine's fence whether a price or a fill is stale.
  The first that finds the pause fences the engine off before it answers
  ([decision 0268](../DECISIONS.md#d0268)), so nothing waits for the tick.
- **No mark while a re-check is open.** A stop before the re-check reported leaves the mark from
  before the resume, so the next start re-checks the whole span once and reports it once. After a
  clock set back, the marks go on from the new time.
- **A locked engine re-checks too.** Its orders skip with `engine_locked`, and the report counts
  them.
- Every kind of resume runs the same re-check ([decision 0267](../DECISIONS.md#d0267)).

## Consequences

- Engine migration 0046 adds `engine_alive`, one row, marked at the migration. The `AliveStore`
  port reads and writes it, with a SQLite adapter, an in-memory fake and a contract suite.
- A write each minute is one row of `engine.sqlite`.
- A start after `binference restart` re-checks after a short stop too, and reports it when it
  checked an order ([decision 0267](../DECISIONS.md#d0267)).
- The first start after the update reports its stop as under a minute: no earlier mark tells
  how long the update took.

## Alternatives

- **Read the newest time any table holds.** A quiet engine writes nothing for hours, so a stop
  would look longer than it was. Rejected.
- **Ask the operating system for its sleep and wake events.** Each OS has its own, and a crash
  or a reboot sends none. Rejected for the wall clock, which covers all three.
- **Count only a stop longer than a threshold as a resume.** A price order can miss its trigger in
  any stop. Rejected.
