# 0273. The daily summary goes once per agent and owner's date, claimed before it is sent

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0057](../DECISIONS.md#d0057) sends a daily summary at 09:00 owner time, and spec 4,
section 4 lists what it holds: total value and its 24-hour change, realized P&L, fills, skipped
fills, open orders, model spend, and anything waiting for the owner. Each agent keeps the
summary's time in its notice settings and may mute the `daily` kind
([decision 0185](../DECISIONS.md#d0185)). No spec says when a summary counts as sent across a
restart, what a summary missed while the engine was off does, how a change of the clocks or of
`owner.timezone` moves it, what the 24-hour change is measured against, or when an agent has
nothing to tell. Live and paper are never added together ([decision 0134](../DECISIONS.md#d0134)).

## Decision

- **When.** A summary is due at the agent's `dailySummaryTime` on today's date of the owner's wall
  clock, in `owner.timezone` as it stands at each run. A time the clocks skip is due at the jump; a
  time they show twice is due at its first, as a schedule runs
  ([decision 0231](../DECISIONS.md#d0231)). A muted `daily` kind turns the summary off: it is
  stored as every muted notice is, and no surface sends it. A new time or zone applies at the next
  run; no config key is added.
- **Once per date.** `daily_summaries` keeps one row per agent and owner's date. A run claims
  today's row, with the totals it read, before it publishes `notice.daily`, and no date at or
  before the agent's latest stored date is claimed. A restart sends no second summary of a date. A
  summary missed while the engine was off goes out at the first run of the same date, and never on
  a later one. After a move of `owner.timezone` to the west, a date already summarized sends
  nothing again, so that day may have none.
- **At most once.** A stop between the claim and the notice loses that day's summary rather than
  sending it twice. A summary is information only: it starts no turn and moves no money.
- **Idle.** An agent that holds no live funds, with no trade, live or paper, no fill or skip of an
  auto order and no model spend in the last 24 hours, no active or paused order, and nothing
  waiting for the owner gets no summary. Its row is stored all the same, with its totals, for the
  next day's change. An agent that holds live funds always gets one, its value and 24-hour change
  at least, as the owner ruled on 2026-10-20; when its live balances cannot be read, its last
  summary's live total decides. A paper agent with nothing else to tell stays quiet.
- **What it says.** It covers the 24 hours before the run. Live and paper each get a line of their
  own, never added together, with the total of the agent's wallets as `portfolio/get` adds it up.
  The 24-hour change is measured against the totals of the agent's previous row when that row is
  20 to 28 hours old, so a day of 23 or 25 hours and a late summary still compare; with no such row
  the change is left out. A live total that cannot be read is said to be unreadable, and the rest
  is told. Realized P&L is what the window's executions realized. Fills are counted, skips by
  reason, at most four reason lines after the notice, the fourth for every reason past three; a
  reason whose message names a cap's figures names the cap alone. Open orders are the active and
  paused ones. Model spend is the window's, beside the daily model budget. What waits for the owner
  is the open cards, the agent's question while it can be answered, the looser limits that wait,
  and the wallets a stuck transaction holds, which the executor names while it watches them.
- **Runs.** The engine runs the summaries every minute, locked or not: they only read and tell.

## Consequences

- Engine migration 0047 adds `daily_summaries`; the `DailySummaryStore` port, its contract suite,
  its fake and its SQLite adapter come with it.
- `OrderStore.fillCounts` counts an agent's fills and skips in a range, and the executor names the
  wallets a stuck step holds. A restart forgets a held wallet until its recovered watch holds it
  again.
- Spec 4 words the summary's lines in English and Chinese, and spec 3 lists the table.

## Alternatives

- **Publish first, then mark it sent.** A stop between the two would send the summary twice.
  Rejected.
- **Measure the change from prices 24 hours old.** binference keeps no price history, and the
  holdings changed too. Rejected.
- **Key each summary by the instant its day starts.** A move of `owner.timezone` to the west within
  a day would start a later instant of the same date and send that date twice. Rejected.
- **Make up a missed summary on the next date.** Its figures would be a day old. Rejected.
- **Send a summary for an idle agent.** A paper agent with nothing else would hear the same lines
  every day. Rejected; an agent with live funds hears its value, by the owner's ruling.
- **Count only activity, not live funds.** The owner would not hear a live wallet's value move on
  a quiet day. Rejected by the owner.
