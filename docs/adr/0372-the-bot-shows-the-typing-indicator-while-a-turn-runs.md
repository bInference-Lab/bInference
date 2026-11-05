# 0372. The bot shows the typing indicator while a turn runs

Status: Accepted

Accepted by the tech lead on 2026-11-05.

## Context

The owner saw no sign that the agent was at work in Telegram. A status message
([decision 0371](0371-a-running-turn-streams-its-text-and-tool-lines-to-one-status-message.md))
shows only 1.5 seconds into a turn. Telegram's `sendChatAction` shows "typing" under the bot's
name for 5 seconds, or until the bot's next message. It is a call like any other: it counts
toward Telegram's limits, and a 429 pauses the bot in that chat. The answer and cards must never
wait behind it.

## Decision

- **When.** The typing indicator goes at the start of each turn in the owner's chat, then every 4
  seconds, before Telegram lets it fade, one send at a time, until the turn ends, its answer is
  refused, or the replies close.
- **A replaceable call.** It goes with a `previewSignal`. The bot's throttler sends it at once,
  outside the chat's line and pace, while the chat has no call in line and no wait Telegram asked
  for; otherwise it is dropped, never queued. A 429 on it pauses the chat for every other call and
  drops it. Answers, status lines and cards keep waiting out a 429 for up to 5 minutes and go.
- **Failures.** A dropped send changes nothing. Any other failure counts; after 5 in a row the
  indicator stops for the turn, so a refused token or a lost chat is not asked again every 4
  seconds.

## Consequences

- The owner sees the agent typing from the first second of a turn.
- A turn adds one call every 4 seconds in the owner's chat, which never delays another call.
- The fake Bot API answers `sendChatAction`, and tests that list a chat's calls leave it out.

## Alternatives

- **Queue it like any call.** It would hold the answer behind it for the chat's one-second pace,
  and pile up during a wait.
- **Renew every 5 seconds.** The indicator would fade between sends.
- **Stop it when the answer is sent.** Telegram clears it with the bot's next message anyway; the
  turn's end is the one place every way out of a turn passes.
