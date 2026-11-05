# 0375. The status message shows only once work starts, with a fixed label

Status: Accepted

Accepted by the tech lead on 2026-11-05, on the owner's decision.

## Context

[Decision 0371](0371-a-running-turn-streams-its-text-and-tool-lines-to-one-status-message.md)
shows a turn's status message 1.5 seconds into the turn whatever the turn does, with how many
seconds the agent has worked, a line for each tool and the answer as the agent writes it. The
owner sent "hey" to a reasoning model and saw "Working on it · 4 s" for a turn that only thought
and answered. The seconds counter changes the message every second, so it is edited every second
a turn runs, and each edit spends the chat's one call a second. The tool lines and the answer's
draft repeat what the answer then says.

The owner chose a quieter default: the typing indicator for a plain answer, a status message only
once the agent works, and the answer whole as a new message.

## Decision

It amends decision 0371's status message.

- **When it shows.** No timer runs from the turn's start. A tool's start (`chat/progress`) shows
  the status message at once. A turn that only writes its answer shows the typing indicator
  alone, however long it takes.
- **What it shows.** A fixed label in bold, `telegram.chat.working`: "Working", in the owner's
  language. Once the agent wrote text before a tool, that text takes the label's place as one bold
  headline, its Markdown drawn as an answer's and cut to 120 characters; a later tool with new
  text before it replaces it. Tool lines are not shown, and neither is the answer while the agent
  writes it.
- **Edits.** The message is edited only when what it shows changes, at most once a second.
- **The rest of 0371 stands:** previews the throttler drops, the failure rules, the answer as new
  messages, the deletion 4 seconds after it showed.

## Consequences

- A plain answer posts one message and no edit.
- A long tool run edits the status message only when the agent writes something new, so it no
  longer spends the chat's pace every second.
- The runtime keeps sending drafts and progress lines; Telegram reads a progress line only as a
  sign of work. The console and terminal chat are unchanged.

## Alternatives

- **Keep the timer from the turn's start.** It shows a status message for a turn that does no work
  beyond its answer, which the owner saw as noise.
- **Keep the seconds counter.** It edits the message every second for nothing the owner needs.
- **Keep the tool lines.** They name steps the answer already reports; the owner chose quiet.
