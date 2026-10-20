# 0269. A wall-clock jump of more than a minute between two ticks is a sleep

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0266](../DECISIONS.md#d0266) finds a sleep of the machine as a jump of the wall clock
past a 5-second tick of the engine's timer. A tick also runs late when the machine is only busy,
so the jump needs a threshold. Below it, nothing is re-checked and no report goes out, and a price
read before the pause may still fire an order. Above it, the owner gets `notice.resumed`. Today:

- the nightly backup counts a jump of more than 5 minutes past its one-minute tick as a wake
  ([spec 5](../specs/keys-and-backups.md) section 7.3);
- a DCA period more than 60 seconds late is missed, never bought
  ([decision 0246](../DECISIONS.md#d0246));
- a fill has 30 seconds ([decision 0197](../DECISIONS.md#d0197)).

## Decision

- **A jump of more than 60 seconds past a tick is a sleep** (the owner's choice), the line past
  which a DCA period is already missed: a pause long enough to miss a period is one the engine
  re-checks after.
- The value is one constant of the composition root's downtime timer.

## Consequences

- A pause of 6 to 65 seconds, such as a busy machine's, is no resume: no report, no fence.
- A laptop that sleeps for more than a minute re-checks its orders on waking, and sends one
  `notice.resumed` when it checked one ([decision 0267](../DECISIONS.md#d0267)).

## Alternatives

- **5 minutes, as the nightly backup.** One rule for a wake across the install; a sleep of 1 to 5
  minutes would neither fence old prices off nor report the DCA periods it missed.
- **15 seconds, three ticks.** Fences off almost every pause; a heavily loaded machine would send
  reports with nothing to say.
