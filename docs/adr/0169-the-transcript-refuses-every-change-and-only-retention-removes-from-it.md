# 0169. The transcript refuses every change, and only retention removes from it

Status: Accepted

Accepted by the owner on 2026-10-11.

## Context

[Spec 8, section 11](../specs/runtime.md#section-11) makes the transcript append-only: an update or
a delete of a `transcript_events` row fails. [Spec 3, section 4](../specs/database.md#section-4)
keeps transcripts for `chats.keepDays`, 90 days by default, so a daily job must delete the events
older than that. A trigger that refuses every delete would refuse the retention job too; a rule
that only the store's code keeps would not hold for a write that reaches the file another way.

## Decision

- Triggers on `transcript_events` refuse every `UPDATE`, and every `DELETE` of an event whose `at`
  is not older than `meta.prune_before`.
- `meta.prune_before` is absent outside the retention job. The job sets it to its cutoff, deletes
  the older events, then removes it, all in one transaction; nothing else writes that key.
- Retention then deletes the turns that ended before the cutoff and hold no event, and the chat
  queue's messages received before it that a turn took or that were dropped. Sessions stay.

## Consequences

- No write, by the runtime or by hand, changes an event; a removal fails unless it is retention's.
- A transaction that set `prune_before` and failed rolls the key back with everything else.
- `chats.keepDays` of `forever` runs no retention, so the key is never set.

## Alternatives

- **Refuse every delete and never prune.** Breaks the 90-day keep of spec 3. Rejected.
- **Keep the rule in the store's code only.** A write by another path could change the record the
  crash repair and the owner rely on. Rejected.
- **Move old events to an archive table.** Spec 3 deletes them after 90 days; an archive keeps what
  the owner asked to forget. Rejected.
