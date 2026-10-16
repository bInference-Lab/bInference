# 0232. A missed schedule runs once, and a run that cannot wake the agent is skipped

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

[Spec 8, section 3.3](../specs/runtime.md#section-3-3) has `inbox/scheduleDue` start a turn,
skipped while the budget is spent or the agent is frozen, and section 8.3 counts each scheduled turn
against the model budget ([decision 0198](0198-each-agents-model-budget-runs-over-the-owners-day-and-pauses-chat-alone.md)).
The plan says a missed schedule runs once. The specs leave open:

- **What counts as missed,** and when the engine runs schedules at all, since a locked engine
  signs nothing and its owner is asked to unlock it.
- **Who skips a run,** the engine or the runtime, and where the skip is recorded.
- **What the owner hears** about a skipped run.
- **A runtime that is down** while the engine wakes the agent every few minutes.
- **A schedule that runs once,** after its run.
- **The data of `inbox/scheduleDue`.**

## Decision

- **The queue.** A timer of the composition root runs the engine's schedule queue every 10 seconds
  while the engine is unlocked. Each run takes the active schedules whose next run came, the
  earliest first, at most 100 a run.
- **Missed runs run once.** A schedule whose time passed while the engine was off, asleep or
  locked runs once at the next run of the queue, however many times it was due, and its next run
  is the first one after now. The wake-up carries the time it was due, so the turn reads as late.
- **The engine skips first.** Before a run stores its wake-up, the engine checks the agent: one
  that is gone or archived skips with `archived`, a frozen one with `frozen`, and one whose model
  budget of the day is spent with `budget`. A spent budget sends `notice.budget`, once that day,
  as a refused turn does.
- **One wake-up at a time.** While a schedule's last wake-up waits in the agent inbox untaken, a
  newer run adds none and skips with `waiting`. A run while the agent holds 200 untaken messages
  skips with `busy`.
- **Every run is recorded.** `schedule_runs` keeps one row per run, its due time, its time, `sent`
  or `skipped` and the reason, and the schedule keeps the last one, which `ScheduleView.lastRun`
  shows. The run, its wake-up in `agent_inbox` and the schedule's next run land in one write.
- **The owner is told once.** A skip sends no notice of its own: `notice.frozen` went out at the
  freeze, `notice.budget` goes once a day, and an archived agent was archived by the owner.
- **The runtime skips too.** A wake-up that waited while the agent was frozen or its budget was
  spent still meets `turn/start`: the engine refuses a turn that holds only wake-ups with
  `agent.frozen` while the agent is frozen, and the runtime drops the wake-ups of a turn refused
  for the budget with the reason `budget`, while the owner's messages wait for the resume.
- **A one-time schedule ends.** After its run, sent or skipped, it moves to the new state `ended`,
  as does a cron schedule with no run in the next eight years.
- **The wake-up.** `inbox/scheduleDue` carries `turn`, `schedule`, `prompt`, `due` and
  `outsideContent`. The schedule's prompt reaches the model with its id and due time; the turn
  starts marked when `outsideContent` is set ([decision 0233](0233-the-owner-and-the-agent-set-schedules-with-no-card-journaled-and-announced.md)).

## Consequences

- Migration 0040 makes `schedules` again with `zone`, the last run's fields, `last_message_id`,
  `outside_content`, `changed_at` and the `ended` state, and adds `schedule_runs`.
- `ScheduleView` gains `ended` and the optional `lastRun`, additions within protocol version 1.
- `turn/start` reads the turn's messages by id with `AgentInboxStore.get` to see whether it holds
  wake-ups alone.
- A schedule set for every minute costs one model turn a minute until the budget is spent; the
  budget bounds it.

## Alternatives

- **Run every missed time.** A week off would start a week of turns at once and spend the budget
  on stale prompts. Rejected.
- **Drop missed runs.** A daily review set for 09:00 would never run on a laptop that sleeps
  through 09:00. Rejected.
- **Run schedules while locked.** A locked engine waits for its owner to fix custody or the signer;
  a turn then proposes trades nobody can confirm. Rejected.
- **Leave every skip to the runtime.** A runtime that is down would let wake-ups pile up for an
  agent that is frozen, and no record would say why a run did nothing. Rejected.
- **A notice per skipped run.** A frozen agent with an hourly schedule would tell the owner every
  hour. Rejected.
