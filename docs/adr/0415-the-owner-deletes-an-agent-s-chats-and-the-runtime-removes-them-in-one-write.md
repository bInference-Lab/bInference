# 0415. The owner deletes an agent's chats, and the runtime removes them in one write

Status: Accepted

Accepted by the tech lead on 2026-11-12. Applies the owner's ruling of 2026-11-12. Amends
[decision 0169](0169-the-transcript-refuses-every-change-and-only-retention-removes-from-it.md).

## Context

An agent's chats live in `agent.sqlite`: sessions, turns, transcript events, the chat queue, goals,
progress notes and helpers, which only the agent runtime writes, under its writer fence (spec 8,
section 2.3). Retention removes them after `chats.keepDays`, 90 days by default
([decision 0169](0169-the-transcript-refuses-every-change-and-only-retention-removes-from-it.md)),
and `binference reset` clears every agent's chats with the engine stopped
([decision 0265](0265-binference-reset-clears-chats-notes-and-caches-behind-a-sealed-backup.md)).
The engine keeps each message for the runtime in `agent_inbox` until the runtime takes it, each
agent's open session, and the agent's questions with their copies on the surfaces. The owner had no
way to delete a chat while binference runs.

The owner ruled on 2026-11-12: deleting chats removes, at once, every transcript event, turn,
queued message, goal, progress note and helper of one chosen agent's chats, or of every agent's.
Notes, which have their own forget, trades, the ledger, positions, notices and spend records stay.
A running answer stops first. The same holds on self-hosted and Cloud, from the terminal and the
console.

## Decision

- **One operation.** `chat/delete` `{ agent? }` deletes one agent's chats, archived or not, or with
  no agent named the chats of every agent not archived. Its scope is `admin`, as an irreversible
  change like a reset; MCP clients and the agent runtime never hold it. It is a write with an
  idempotency key. It answers how many sessions, turns, events, queued messages, goals, progress
  notes and helpers went from `agent.sqlite`, and how many inbox messages and open questions the
  engine let go.
- **Never without the runtime.** The engine never writes `agent.sqlite`. While the runtime is down
  the call is refused with `chat.needs_runtime`, whose words say to start binference and try
  again, before anything changes.
- **The hold.** From before its inbox delete until it answers, whether it succeeds or fails, the
  engine holds every new agent inbox message of the agents. The owner's messages and answers on
  every surface, credential answers, the ends of shell commands, freeze stops, resume reports,
  schedule runs and alert wake-ups wait, then land in the new chat. The wake-ups the agent runtime
  asks for itself, a helper's report, the next goal turn and the end of an image or video job, are
  dropped instead, as a full inbox drops them: the runtime may wait on them as it ends the chat,
  so holding them would stall the deletion until the 10-second route bound. A trade's settle
  message rides the money path's own write and is not held: one that lands meanwhile goes with the
  old chat, and the trade's card still shows its receipt.
- **The engine's part, first.** It stops the agents' shell commands, as `chat/stop` does. In one
  write of the agent inbox it deletes every message of the agents, taken or not: an untaken one
  would otherwise reach the runtime after the delete, and a taken one keeps the same words for
  retention's 30 days. The same write lets go each agent's open session, so the owner's next
  message opens a new one. Then it closes each agent's open question with `closeReason: cleared`,
  as `chat/clear` does: its copies in Telegram stay, without their buttons, and the closed
  question is kept for retention's 30 days.
- **The runtime's part.** The engine routes the call to the runtime with the agents it resolved.
  The runtime takes it in line with the messages it receives, ends each agent's running turn as a
  stop does and waits for its end, stops the agent's helpers and waits for theirs, ends its goal's
  wait, and forgets the agent's open session. Then one store task, under its writer fence, removes
  every session of the agents, a helper's own among them, with every transcript event, turn,
  queued message, goal, progress note and helper they hold, in one transaction. The task sets
  `meta.prune_before` past every event, so the transcript's trigger lets the removal through, and
  removes the key before it commits, as retention and reset do. Nothing a stopped turn writes can
  land after it.
- **Every surface clears.** The engine pushes `chat/deleted` `{ agent }` on each agent's chat
  topic; the console and terminal chat clear the chat they show. Telegram has nothing to clear: its
  messages are the owner's.
- **What stays.** Notes, workspace files, the agent's settings, auto orders, alerts, schedules,
  trades and every money record, notices and model spend. Backups made before the delete still hold
  the chats until they are pruned or removed; the command's answer and the console's confirmation
  say so.
- **Amends 0169.** Retention, the reset and a deletion each set `meta.prune_before` inside their own
  transaction and remove it before it commits; nothing else writes the key.

## Consequences

- The owner deletes a chat at once, on self-hosted and Cloud alike, with nothing of it left in the
  agent database.
- A deletion whose route fails after the engine's part leaves the inbox and questions let go. After
  a crash the chats stay in place; after the 10-second route bound, `engine.timeout`, the runtime
  may still finish it, and no surface hears `chat/deleted`. Either way the owner runs it again,
  which deletes what is left and clears the surfaces.
- A message stored while the deletion runs waits in the engine until the deletion answered, then
  opens the new chat. A schedule run or an alert of the agent waits as long, and delays the runs
  and fires after it in its own line. The runtime holds a message that reaches it during its part
  too, for a deletion whose route bound passed while the runtime still works on it.
- Spec 1 gains `chat/delete`, the push `chat/deleted` and `chat.needs_runtime`; spec 3 notes the
  deletion beside retention; spec 8 routes `chat/delete` and names the store task.

## Alternatives

- **The engine stores `inbox/stop` and the runtime deletes later.** The stop reaches the runtime
  through the inbox the deletion empties, and a turn still ending would write after the delete.
  Rejected: the runtime ends the turn itself, then deletes.
- **The engine writes `agent.sqlite`.** The runtime owns that file and its fence; two writers would
  break both. Rejected.
- **Keep the inbox's taken messages.** They hold the owner's words for 30 more days. Rejected.
- **Hold the wake-ups the runtime asks for too.** A turn's end or a helper's stop that waited on
  one would wait for the deletion that waits for it, until the route bound. Rejected: they belong
  to the chat being deleted, and are dropped.
- **Hold a trade's settle message too.** It is written with the intent's move, which no chat may
  stall. Rejected.
- **Delete closed questions too.** Their copies stay in Telegram anyway, and a press on one finds
  nothing open either way. Rejected for the closing that `chat/clear` already does.
