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
  minute old at most.
- **A start that finds a mark is a resume.** The engine was off from the mark to the start. The
  first start of an install finds none and re-checks nothing. Every later start re-checks, however
  short the stop: an order cannot tell a short stop from a long one.
- **A jump of the wall clock is a sleep.** A timer of the composition root sleeps 5 seconds at a
  time through the `Clock` port. A sleeping machine stops the timer, never the wall clock, so a
  tick that finds the wall clock moved more than the sleep threshold past its sleep
  ([decision 0269](../DECISIONS.md#d0269)) is a resume: the machine slept from the tick before.
- **No mark while a re-check is open.** A stop before the re-check reported leaves the mark from
  before the resume, so the next start re-checks the whole span once and reports it once.
- **A locked engine re-checks too.** Its orders skip with `engine_locked`, and the report counts
  them.
- Both kinds of resume run the same re-check
  ([decision 0267](../DECISIONS.md#d0267)).

## Consequences

- Engine migration 0046 adds `engine_alive`, one row. The `AliveStore` port reads and writes it,
  with a SQLite adapter, an in-memory fake and a contract suite.
- A write each minute is one row of `engine.sqlite`.
- A start after `binference restart` re-checks after a short stop too, and reports it when it
  checked an order ([decision 0267](../DECISIONS.md#d0267)).

## Alternatives

- **Read the newest time any table holds.** A quiet engine writes nothing for hours, so a stop
  would look longer than it was. Rejected.
- **Ask the operating system for its sleep and wake events.** Each OS has its own, and a crash
  or a reboot sends none. Rejected for the wall clock, which covers all three.
- **Count only a stop longer than a threshold as a resume.** A price order can miss its trigger in
  any stop. Rejected.
