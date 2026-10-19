# 0247. An agent's alert and schedule tools act for it alone and show which schedules are marked

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 8](../specs/runtime.md) section 5.1 makes `alert_create`, `schedule_create` and
`schedule_cancel` control tools and `schedule_list` a read. They map onto `alert/create` and the
`schedule/*` operations of [spec 1](../specs/protocol.md) section 7.5. The specs leave open:

- **Which schedules a tool may touch.** The runtime's token holds `agent` beside `propose`, so the
  engine lets it cancel any agent's schedule
  ([decision 0233](0233-the-owner-and-the-agent-set-schedules-with-no-card-journaled-and-announced.md)).
- **How the model writes a time.** `expiresAt` and `when.at` are epoch milliseconds. A model
  writes 13-digit numbers poorly, and the live facts give it the time in the owner's timezone.
- **What the model reads when the engine refuses** a condition, a time or a cap.
- **Whether `schedule_list` reads outside content.** A schedule set in a marked turn may carry a
  prompt written from a web page or a post. `ScheduleView` does not say which schedules are
  marked, and spec 8 section 5.4 lists no schedule tool.

## Decision

- **Its own agent.** Each tool names its turn's agent, and the model names none
  ([decision 0176](0176-an-agent-s-tools-act-only-for-their-own-agent.md)). `schedule_list`
  lists the agent's active schedules. `schedule_cancel` first lists them and cancels only one of
  them; any other id is answered as a schedule the agent does not have, as `order_cancel` does.
- **Times.** `alert_create`'s `expiresAt` and `schedule_create`'s `when.at` are ISO 8601 date-times
  with an offset, such as `2026-10-20T09:00:00+08:00`; the tool turns them into epoch
  milliseconds. Times in the results are ISO 8601 in UTC.
- **Refusals.** Arguments that fail the tool's schema never reach the engine, and the model reads
  the schema's issues; a prompt over 2,000 characters is one. `alert.too_many`,
  `wallet.track_limit`, `market.no_data`, `protocol.bad_args`, `schedule.bad_when`,
  `schedule.too_many` and `schedule.not_found` each read as one sentence: nothing was stored, why,
  and what to do next. Any other code reads as the tool's failure with the engine's message.
- **No commit.** The three writes are control tools: none commits the turn, and each sends its
  call's key as its idempotency key.
- **The mark.** `ScheduleView` gains `outsideContent`, an optional field the engine always sends. A
  `schedule_list` result that lists a marked schedule is outside content, as a `notes_search`
  result with an `untrusted` note is.

## Consequences

- The agent can set alerts and schedules and cancel its own schedules without a card, and the
  owner hears of each schedule through `notice.scheduleSet` and `notice.scheduleCancelled`.
- A turn that lists a schedule set from outside content carries the mark, so its proposals warn
  and never fill in auto mode.
- Spec 1 sections 7.5 and 9 and spec 8 section 5.4 say so. No MCP tool changes.

## Alternatives

- **Epoch milliseconds in the tools' arguments, as the operations take them.** Rejected: a wrong
  digit sets an alert's end or a run years away, and nothing shows the model its mistake.
- **Every `schedule_list` result as outside content.** Rejected: a turn that only checks its own
  schedules would lose auto mode for nothing.
- **Leave the prompts out of `schedule_list`.** Rejected: the agent needs a schedule's prompt to
  tell the owner which one it cancels.
