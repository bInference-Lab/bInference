# 0384. The agent reads a note whole and forgets its own notes

Status: Accepted

Accepted by the owner on 2026-11-07.

## Context

The agent could search its notes and write new ones, but not read one note whole nor remove one.
When the owner said "forget that" or a saved plan stopped being true, the wrong note stayed, and
only an owner credential could delete it through `notes/delete`.

## Decision

- Two routed operations, additions to protocol version 1: `notes/get` reads one of the agent's
  notes whole, with its origin, and `notes/forget` removes one of the agent's own notes from lists
  and searches. A note of another agent, or one removed before, is `note.not_found`.
- The agent gets `notes_get`, a read whose answer marks the turn when the note is labelled
  untrusted, and `notes_forget`, a control tool. Its description has it forget a note when the
  owner asks, or when the note is wrong or no longer true, then save the right one.
- `notes/delete` stays the owner's removal of any note.

## Consequences

- The agent keeps its memory right as the owner's plans change.
- Outside content could lead the agent to forget a note; nothing that moves money rests on a note,
  and the owner can save it again.

## Alternatives

- **Let the agent call `notes/delete`.** It names no agent, so one agent could remove another's
  note.
