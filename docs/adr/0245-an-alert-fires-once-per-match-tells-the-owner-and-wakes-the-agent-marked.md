# 0245. An alert fires once per match, tells the owner, and wakes the agent marked

Status: Amended by 0274

Accepted by the owner on 2026-10-19.

## Context

[Spec 1](../specs/protocol.md) section 8.4 says when each alert fires, what `alert/fired` carries,
and that a wake-up from an alert stores `inbox/alertFired`, at most 10 an hour per agent, one per
alert while it waits. [Spec 8](../specs/runtime.md) section 3.3 has the runtime skip a wake-up while
the budget is spent or the agent is frozen. The specs leave open:

- **Which price fires a price alert,** and whether a price the watcher skipped past counts.
- **Where the engine skips a wake-up:** before storing it, as a schedule's run does
  ([decision 0232](0232-a-missed-schedule-runs-once-and-a-run-that-cannot-wake-the-agent-is-skipped.md)),
  or only in the runtime.
- **How the hourly limit and the held-back count survive a restart.**
- **Which wake-ups are marked.** Section 8.4 marks three cases: a marked alert, a launch, an
  unlisted token.
- **How the leader watcher and the launch feed,** which do not run yet, reach the alerts.
- **When an expired alert ends.**

## Decision

- **The price.** A price alert is judged on each confirmed price the price watcher hands the
  engine, in exact micro-dollars per whole token, at its level and past it, never as a crossing:
  a price the watcher skipped past fires at the next read. The alert's token is watched while the
  alert is active, as an order's is; a token the watcher cannot price is reported by
  `notice.watcherUnpriced` ([decision 0194](0194-the-price-watcher-proves-its-pools-and-is-never-silent.md)).
- **Once per fire.** Each fire is written under the count of fires the alert had, so two reads
  that race fire it once; a price alert moves to `fired` in that write.
- **The engine skips first.** Before a fire stores its wake-up, the engine checks the agent as the
  schedule queue does: gone or archived skips `archived`, frozen `frozen`, a spent budget `budget`
  with `notice.budget` once that day. The store then replaces the alert's last wake-up while it
  waits untaken, else skips `hourly` past 10 wake-ups of the agent's alerts in the last 60 minutes,
  else `busy` at 200 untaken messages, else stores a new one. The runtime's own skips stay.
- **Every fire is a row.** `alert_fires` keeps each fire with what it did about its wake-up, in
  the write that records it. The hourly limit and `wakeSkipped` read these rows, so a restart keeps
  them; an agent's rows older than 7 days are dropped in the same write.
- **Every wake-up is marked.** A wake-up carries what a market or another wallet did: a price,
  another account's trade, a launch named by its deployer. Each one starts its turn marked, so the
  turn proposes only to a card. This is stricter than section 8.4's three cases.
- **The watchers' port.** The engine's `alerts` part takes `seePrice` from the price watchers,
  `seeTrade` (an account, its `ActivityItem` and its tokens' info) from the leader watcher, and
  `seeLaunch` (a `LaunchView`, its liquidity when read, and its tokens' info) from the launch
  feed. A launch filter's bound on a value the feed did not read never passes. The port holds no
  intent store, executor or venue: an alert cannot reach the money path.
- **The notice.** Each fire sends `notice.alertPrice`, `notice.alertWallet` or
  `notice.alertLaunch`, followed by `alert.woke` and `alert.wakeSkipped`, which the owner may mute
  per agent
  ([decision 0185](0185-an-agent-mutes-notices-by-kind-and-never-a-security-notice.md)). A wallet
  is named by its address book label, else its short address; a trade with no dollar value shows
  what it traded for. `alert/fired` goes out for every fire.
- **Five notices an hour per alert** (the owner's choice, 2026-10-19). An alert's hour begins at
  its first notice; its first five fires in it notify, the rest are counted. When the hour ends,
  one line tells the count, "12 more matches this hour, see the console" (`notice.alertHeld`), and
  the alert notifies again from its next fire, which begins a new hour; a fire that begins it
  before the line went tells the count first. A price alert fires once, so the bound never holds
  it back. Wake-ups keep their own limit. An agent keeps its newest 1,000 fire records at most,
  beside the 7 days.
- **What the watchers hand is read in canonical form.** A trade's account and assets and a
  launch's tokens are put in their chain families' canonical forms before they are matched, as
  `alert/create` stores conditions, so an address in another case still matches.
- **An archived agent's alerts end.** A fire for an agent gone or archived ends the alert, with no
  notice, and the caps do not count an archived agent's alerts. The operation that archives an
  agent ends its alerts in its own write once it exists.
- **Every alert is read.** The firing and the price watchers read the active alerts page by page,
  and a price alert's asset is stored apart, so each price reads only the alerts on its token.
- **Expiry.** The orders' 10-second tick also ends each active alert whose expiry came, and tells
  the held matches of each notice hour that ended.

## Consequences

- The leader watcher calls `seeTrade` for each trade it records of a tracked account, and the
  launch feed calls `seeLaunch` once for each launch it stores, after the write that keeps it.
- A wake-up the runtime already queued keeps the data it had when a newer fire replaced it in the
  inbox; the newer fire's notice has reached the owner.
- Spec 1 section 8.4, spec 3 section 2.4 and spec 8 section 3.3 say so.

## Alternatives

- **Fire on a crossing.** A price the watcher skipped past, as after a restart, would never fire.
  Rejected.
- **Skip only in the runtime.** A frozen agent would collect wake-ups in its inbox while the 200
  limit holds the owner's messages. Rejected.
- **Count wake-ups in memory.** A restart would forget the hourly limit. Rejected.
- **Mark only section 8.4's three cases.** A price alert on a listed token would wake a clean turn
  on a number a pool's trades set. Rejected for the stricter rule.
