# 0178. Telegram chat batches the owner's messages, and previews give way

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[ARCHITECTURE.md](../ARCHITECTURE.md) section 12 says the engine relays the owner's Telegram
messages to the agent runtime, batches pasted text within 300 ms, streams a reply as one status
message edited about once a second and then the final answer as a new message, escapes model text,
and that one throttler per bot token owns every 429 wait, dropping previews and retrying results.
[Spec 1](../specs/protocol.md) section 7.7 takes at most 4 images of at most 5 MiB per message and
says Telegram images need no upload. Some cases are left open:

- **How a batch ends.** A quiet window alone lets a long paste wait without end.
- **Edits, forwards and media the agent cannot read.** Telegram sends each as a message.
- **Telegram's photos.** `chat/post` names images by upload id; a Telegram photo has only the
  bot's file id, and an album comes as one message per photo.
- **What the status message shows.** The runtime sends the final text, and drafts only when it
  streams them.
- **Which call is a preview.** grammY hands the throttler a method, a payload and a signal.
- **Durability.** The ingress marks an update handled once the owner's message is held, and a
  batch is held in memory for its window.

## Decision

- **Batches.** A chat's messages join when each comes within 300 ms of the one before, a line
  apart, up to 12 messages, 50,000 characters or 3 seconds from the first, when the batch goes at
  once. Batches are posted one at a time, in the order they closed, to the only agent; with none
  or several, the owner is told as `/paper` tells it.
- **Not for the agent.** An edit, a forwarded message and a message with neither text nor a
  photo go nowhere, and the owner is told at once why. A forward is someone else's words, and
  `chat/post` has no way to mark them as outside content.
- **Photos.** Each photo is named `tg:<file_id>`, the file id of its largest size. A photo over
  5 MiB by Telegram's own count is left out, then every photo past the first 4; the owner is told
  how many, and the rest of the message goes.
- **The status message.** At `chat/turnStarted` the owner's chat gets "Working on it · {seconds}
  s", refreshed once a second with the time, or with the text the agent has written so far once a
  draft comes. The final text goes as new messages, which notify the owner where an edit does
  not, split at 4,096 characters, and then the status message is deleted, as it is at
  `chat/turnEnded`. A status line goes as its own message in italics.
- **Model text.** It is sent in Telegram's HTML with every character escaped, after each line goes
  through `displayOutsideText`, so markup in it reads as text and hidden characters are written
  out.
- **Previews.** A call made with a `previewSignal` is a preview. The throttler rejects it with
  `telegram.preview_dropped`, never sent again, when its chat has a call in line or a wait
  Telegram asked for, and when Telegram answers it with a 429, which still pauses the chat. Every
  other call waits out the 429 and goes.
- **At most once.** A message is posted at most once: a stop inside its 300 ms window drops the
  batch, and the owner sees no status message and writes again.

## Consequences

- A paste of several messages, or an album, starts one turn, and a long one never waits more
  than 3 seconds.
- The status message costs about one edit a second while a turn runs, and gives way to every
  answer and card, so a 429 delays only the next preview.
- The runtime reads `tg:` images through the bot when it reads the owner's images.
- A forward the owner meant for the agent has to be written again in the owner's own message.

## Alternatives

- **Post each message at once.** A paste Telegram splits becomes several turns, and a merge can
  run a trade on half of what the owner wrote. Rejected.
- **Edit the status message into the answer.** An edit does not notify the owner, and a trade's
  outcome must. Rejected.
- **Keep the status message after the answer.** It repeats "Working on it" above every answer.
  Rejected.
- **Retry previews like results.** A preview that waits only holds back the answer it would be
  replaced by. Rejected.
- **Refuse the whole message past 4 photos.** The owner loses the text and the photos that fit;
  telling how many were left out keeps the rest. Rejected.
