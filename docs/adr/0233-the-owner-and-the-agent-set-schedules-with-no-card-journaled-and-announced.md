# 0233. The owner and the agent set schedules with no card, journaled and announced

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

[ARCHITECTURE.md section 26](../ARCHITECTURE.md#section-26) has the agent create a schedule with
`schedule_create`: "no money, no tap". [Spec 8, section 5.2](../specs/runtime.md#section-5-2) lists
`schedule_create` and `schedule_cancel` as control tools, and section 4.3 has a schedule set in a
turn that read outside content start its own turns marked. `schedule/create` and `schedule/cancel`
take the `propose` scope ([spec 1, section 7.5](../specs/protocol.md#section-7-5)). The specs leave
open:

- **Whether an outside client's schedule is marked.** An MCP client also holds `propose`, and its
  words are not the owner's.
- **How a change is journaled and announced,** as settings changes are.
- **Who may cancel which schedule.**
- **Bounds:** how many schedules an agent holds and how long a prompt is.

## Decision

- **No card.** `schedule/create` stores an active schedule at once, for the owner's surfaces and
  for the agent runtime alike. A schedule moves no money; every turn it starts proposes through
  the money path and its cards as any turn does.
- **The mark.** A schedule set in a turn that read outside content, or by a client with `propose`
  alone, is stored with `outside_content`, and each of its turns starts marked. A schedule the
  owner set, or the agent set in a clean turn, holds the owner's words, so its turns start clean,
  and anything the turn reads marks it as usual.
- **Journaled and announced.** A schedule set or cancelled is journaled under
  `agents.<name>.schedules` with who and where, pushed as `config/changed`, and announced on every
  surface: `notice.scheduleSet` with the prompt and the next run, and `notice.scheduleCancelled`.
  Each names the agent runtime as "the agent", else the surface the owner used. Neither can be
  muted: a schedule the owner did not set should never run unseen.
- **Cancel.** The owner's surfaces and the agent runtime cancel any schedule; a client with
  `propose` alone, only the ones it set, as with auto orders. A schedule that is not active is
  `schedule.not_found`.
- **Bounds.** An agent holds at most 50 active schedules; one more is `schedule.too_many`. A prompt
  holds at most 2,000 characters; a longer one is `protocol.bad_args`.
- **While frozen.** A frozen agent's schedules can still be set and cancelled; their runs skip
  until it is unfrozen ([decision 0232](0232-a-missed-schedule-runs-once-and-a-run-that-cannot-wake-the-agent-is-skipped.md)).
  An archived agent takes none.

## Consequences

- The agent's `schedule_create`, `schedule_list` and `schedule_cancel` tools map to these
  operations as they are; no MCP tool exposes schedules.
- Spec 4 gains `notice.scheduleSet` and `notice.scheduleCancelled` in both languages.
- `schedule/list` answers the active schedules, oldest first; at 50 per agent it needs no paging.

## Alternatives

- **A card for each schedule.** Section 26 says no tap, and a card for a reminder trains the owner
  to tap without reading. Rejected.
- **Leave an outside client's schedule clean.** Its prompt would wake the agent with words the
  owner never wrote, and a turn from it could pass the auto test. Rejected.
- **No notice.** A schedule the agent set from a marked turn would run unseen until its first
  turn. Rejected.
