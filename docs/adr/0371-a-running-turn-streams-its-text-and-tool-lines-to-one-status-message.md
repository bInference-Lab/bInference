# 0371. A running turn streams its text and tool lines to one status message

Status: Amended by 0375

Accepted by the tech lead on 2026-11-05.

## Context

The owner chatted with the beta's bot and saw each answer arrive whole, with no text as the agent
wrote it and no sign of the tools it ran. The model providers already stream, and `turn/say` takes
`final: false` for a draft, but the runtime sent only the final text. The status message of
[decision 0178](0178-telegram-chat-batches-the-owner-s-messages-and-previews-give-way.md) showed
the seconds the agent worked and was sent the moment a turn started, so a quick answer flashed a
message that was deleted a second later.

Telegram allows about one message a second in a private chat, and an edit counts. An edit does not
notify the owner; a new message does. A trade report must notify. The answer, cards and notices
must never wait behind a preview, and a preview must never post a second status message for one
turn.

## Decision

It amends decision 0178's status message.

- **The runtime streams.** While a model call of the turn's own chain streams, its text so far goes
  to the engine as `turn/say` with `final: false`, at most every 250 ms, the newest text replacing a
  draft not yet sent. A summary or vision call sends none. As each tool call starts, the runtime
  sends `turn/progress` with the tool's line of spec 4, after the draft written before it; asking
  the owner and the first chat's end send none. A plugin's tool shows the plugin's id. One send at a
  time, in order, each given up after 5 seconds or a failure, and all settle before the final text.
- **`turn/progress` and `chat/progress`.** A new operation of the `agent` scope, which only the
  runtime's current token may call, pushes `chat/progress` `{ agent, turn, progressKey, values? }`
  on the agent's chat topic. Nothing stores it. The console and terminal chat show the draft as the
  answer so far and no progress line.
- **The status message in Telegram.** It first shows 1.5 seconds into the turn, or at once for a
  tool's line, so a turn that answers sooner shows none. It holds how long the agent has worked, a
  work line for each tool (the newest 8, each cut to 120 characters, a line repeated in a row once),
  the text written before a tool as one line of at most 280 characters, and the draft, drawn by the
  renderer of [decision 0370](0370-the-agent-s-chat-text-shows-its-markdown-in-a-fixed-set-of-telegram-tags.md)
  and cut from its start with `…` to fit 4,096 characters. It is edited at most once a second.
- **Sends, edits and failures.** The first send and every edit are previews the throttler drops
  rather than queue. HTML Telegram cannot read goes as plain text; an edit that changes nothing
  counts as shown. A dropped preview waits for the next refresh. An edit's network fault or 5xx, or
  a first send that provably never left, may fail 3 times in a row; any other failure stops the
  edits for the turn, and a first send that may have landed is never sent again.
- **The answer.** Edits stop and the one under way finishes, then the answer goes as new messages.
  The status message is deleted once it has shown for 4 seconds, without holding the answer. An
  answer Telegram refuses turns the status message into `telegram.chat.notDelivered`, or sends that
  line when none showed. A new turn of the same agent removes an earlier turn's status message.

## Consequences

- The owner sees the agent's text and tools as it works, and the answer still notifies.
- A quick answer posts one message instead of two.
- `turn/progress` and `chat/progress` are additions to protocol version 1.
- The runtime sends up to four drafts a second per turn over its local link, and the engine relays
  each; the Telegram side reads only the newest once a second.
- Tests that read the pushes of a turn see its drafts and progress lines, and tests of the bot
  advance the clock past the status message's 4 seconds before they wait for it to be idle.

## Alternatives

- **Edit the status message into the answer.** An edit does not notify, so the owner would miss a
  trade report.
- **Telegram's `sendMessageDraft`.** Its drafts are short-lived previews that vanish on their own,
  so a long turn would lose its status.
- **Tool lines as `turn/status`.** A status line is a new message that stays in the chat; ten tool
  calls would leave ten messages.
- **Show the status message at the turn's start.** A quick answer would flash a message and its
  deletion.
