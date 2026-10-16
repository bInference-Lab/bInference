# 0242. The agent writes the strategy only from a clean turn and ends its first chat

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

[Decision 0061](../DECISIONS.md#d0061) and [spec 4](../specs/cards-and-messages.md#section-8-3)
section 8.3 have the agent interview the owner in paper mode, then write `STRATEGY.md` and
`PERSONA.md` and remove `FIRST-CHAT.md`. [Decision 0200](0200-the-engine-keeps-the-workspace-files-and-the-runtime-reads-them-each-turn.md)
makes the engine the files' one writer, gives the owner `agent/writeFile` (`admin`), and leaves
the first chat's writes to an operation of the `agent` scope. The specs leave open:

- **Which files the agent may write**, and when. The files open every model call's stable prefix
  as the owner's words, so a turn that read a web page could carry that page into every later turn
  with no outside-content mark, and its proposals would fill in auto mode.
- **How the first chat ends**, and how the turn that ends it gets `turn.firstChatDone`.
- **Live mode.** The first chat runs in paper mode; nothing stops it once the agent is live.
- **Skip and restart.** What "skip" writes, and where a first chat that a restart cut goes on.
- **A limit asked for in chat.** No tool sets one, and the model must say so.

## Decision

- **Two operations of the `agent` scope.** `agent/editFile` `{ agent, file, text }` replaces
  `STRATEGY.md` or `PERSONA.md` whole, at most 12,000 characters, the size the prefix keeps of a
  file. `agent/endFirstChat` `{ agent }` removes `FIRST-CHAT.md`, and answers `agent.file_missing`
  once it is gone. Both refuse an archived agent. The `WorkspaceFiles` port gains `remove`.
- **Only a clean turn writes.** `agent/editFile` takes the mark of the agent's running turn as a
  proposal does: the engine accepts it only from the runtime it runs now, in a running turn of that
  agent whose context holds no outside content. Any other call fails `agent.file_untrusted`, and
  the file is unchanged. The owner's answers are the owner's words; what the agent read from
  outside keeps its mark and never becomes the owner's. Ending the first chat carries no text, so
  any turn of the agent may end it. `RULES.md`, `OWNER.md` and `NOTES.md` stay the owner's.
- **Two control tools.** `workspace_write` calls `agent/editFile`, and its answer to
  `agent.file_untrusted` tells the model to ask the owner to send `/clear` and answer again, or to
  edit the file in the console. `first_chat_end` calls `agent/endFirstChat`. A tool's result may
  carry a closing line; a turn that ends `ok` with no status line of its own ends with it, so the
  turn that ended the first chat sends `turn.firstChatDone`.
- **Paper mode only.** While `FIRST-CHAT.md` exists, the runtime reads the agent's mode from the
  live facts before each turn, and leaves the file out of a live agent's prefix. A live agent never
  sees the first chat; back in paper mode it goes on.
- **Owner turns only.** The instructions have the agent follow `FIRST-CHAT.md` only in a turn that
  answers the owner's own message, ask one question at a time and only those the conversation has
  not answered yet.
- **Skip.** On "skip", in either language, the agent writes what it has and ends the first chat. A file the
  owner gave no answer for keeps the text it was made with: the defaults.
- **Restart.** The answers so far live in the session's transcript, which a restart keeps, and
  `FIRST-CHAT.md` stays until the end, so the next turn goes on from the conversation. `/clear`
  starts the questions again.
- **Limits.** No tool changes a limit. The instructions tell the agent to say a limit asked for in
  chat stays as it is, and to point to `binference limit set` or the console.

## Consequences

- A conversation that read outside content cannot change the strategy or the persona, nor carry
  that content unmarked into later turns. An owner whose first chat read a web page saves the
  answers after `/clear`, or edits the files in the console.
- While the first chat is open, each turn makes one more `facts/get` before its first model call.
- The first chat ends once: its file is gone, and `turn.firstChatDone` goes out once.
- Spec 1 gains `agent/editFile`, `agent/endFirstChat` and `agent.file_untrusted`; spec 8 gains the
  two control tools, and its prefix leaves `FIRST-CHAT.md` out while the agent is live.

## Alternatives

- **Accept the write from a marked turn.** The file would hold outside text as the owner's words in
  every later prefix, unmarked. Rejected for money safety.
- **Mark a file written from a marked turn, and every turn that reads it.** Every later turn would
  carry the mark until the owner rewrote the file, and auto mode would stop with no visible reason.
  Rejected.
- **A generic write of any workspace file for the agent.** The agent could rewrite its own rules.
  Rejected.
- **Remove `FIRST-CHAT.md` when the agent goes live.** The mode switch would change the workspace,
  and a crash between the two would leave a live agent with the first chat. Rejected for the read
  at each turn.
- **The engine sends `turn.firstChatDone` when the file goes.** The line would come before the
  agent's last answer, not at the turn's end. Rejected.
