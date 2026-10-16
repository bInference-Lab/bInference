# 0227. An image reaches only a model declared to read it, and lives for one turn

Status: Amended by 0228

Accepted by the owner on 2026-10-16.

## Context

[Spec 1](../specs/protocol.md#section-7-7) section 7.7 takes at most 4 images per message, each
a PNG, JPEG or WebP of at most 5 MiB, as upload ids or `tg:<file_id>`, and marks the turn as
outside content. [Spec 8](../specs/runtime.md#section-8-1) section 8.1 sends images to `main` when
it reads images, else to `models.vision`, whose description `main` gets as outside content. Some
cases are left open:

- **How the runtime gets the bytes.** The bot token and the uploads live in the engine, and a
  protocol frame holds at most 1 MiB.
- **How the runtime knows a model reads images.** The config names models by `<provider>/<model>`
  only, and neither provider documents image input for every model id in a form binference can
  track.
- **When the limits are checked**, and what the owner hears when an image is refused.
- **Where the bytes live, and for how long.** Spec 3 keeps transcripts 90 days.
- **A message with images that arrives while a turn runs**, which would join it at a merge point
  after that turn's model was chosen.
- **Telegram files.** The Bot API's `getFile` serves files of up to 20 MB, through a link that
  holds the bot token.
- **How long an upload lives** between `POST /upload/:ticket` and the turn that reads it.

## Decision

- **`inbox/readImage`.** The runtime reads an image of an `inbox/message` with the operation
  `inbox/readImage` (`agent` scope, the engine's current runtime only), 512 KiB of the image at a
  time as base64, so every answer fits a frame. The engine answers only for an image the agent's
  own stored message names: else `image.not_found`. It reads the source once, checks the size
  and the format by the file's first bytes (`image.too_large`, `image.format`), and holds the
  bytes in memory until the last part is read, or for 2 minutes, at most 8 images at once, the
  oldest dropped first. A source that no longer has the file answers `image.unreadable`.
- **Telegram.** The engine calls `getFile` through the bot's throttled client, refuses a file over
  5 MiB by its `file_size` before any download, and downloads `file_path` through the outbound
  HTTP port with the same byte limit. A `getFile` refusal is `image.unreadable`, or
  `image.too_large` when Telegram says the file is too big; no answer is `telegram.unreachable`.
  The link holds the token, so it is never logged or passed on. A document whose MIME type is PNG,
  JPEG or WebP counts as a photo.
- **Uploads.** `upload/start` issues a single-use ticket for 2 minutes, at most 64 open at once;
  the body must have the declared length and type, checked by its first bytes, and only the
  engine's own address takes it. An upload lives in engine memory for 1 hour, at most 16 at once,
  the oldest dropped first, and never reaches the disk.
- **A declared capability.** `models.imageInput` lists the `<provider>/<model>` names that take
  images, default none. `models.vision`, or the vision model the owner picked with `/ai`, reads
  images by its role. A model's name never decides it.
- **Limits before any model call.** A turn that takes messages with images reads them all after
  `turn/start` and before its first model call, and checks each message's count, each image's
  size and its format. A failure ends the turn `failed` with a status line that names the limit
  (`turn.image.*`, [spec 4](../specs/cards-and-messages.md#section-8-1) section 8.1), and no
  model is called.
- **Main or vision.** When the turn's model takes images, each image goes with the owner's
  message, before its text, in the transport's own format: an `image_url` data URL for Chat
  Completions, an `image` block with a base64 source for Messages. Otherwise the vision model
  describes each image in its own call, recorded on the turn like any other; each description is
  stored as a transcript `image` event marked outside and reaches the main model with the
  message as outside content. With neither, the turn ends with `turn.image.noVision`, which names
  `models.vision`. A fallback model that takes no images is skipped in a turn that holds them.
- **One turn.** The bytes live in the runtime's memory for the turn that takes the message and
  are dropped when it ends, however it ends. They are never logged or written to `agent.sqlite`:
  the transcript keeps the owner's text, the number of images and any description. A later turn
  reads a line saying the owner sent images the agent no longer sees.
- **One message's images a turn.** A message with images never joins a running turn: it waits for
  the next one. A turn takes the waiting messages through the first that holds images, so it holds
  at most 4 images, about 28 MB in base64, under each provider's request limit; the messages after
  it wait for the turn after. The engine still marks the running turn when such a message arrives,
  since it cannot see whether the runtime merges.

## Consequences

- No image byte crosses a frame over 1 MiB, and the bot token stays in the engine.
- An owner whose main model reads images lists it once in `models.imageInput`; until then images
  go to `models.vision`, or are refused with the words that name it.
- A refused image costs no model call, and the owner hears which limit it passed.
- A follow-up question about an image a main model saw in an earlier turn gets no image: the owner
  sends it again. A vision description stays for the session.
- An upload is gone after a restart or an hour, and its message's turn ends with
  `turn.image.unreadable`.
- A running turn may carry the outside-content mark for an image it never reads.

## Alternatives

- **A larger frame for `inbox/readImage`.** It raises the memory every connection may claim for
  one operation's sake. Rejected.
- **The runtime downloads Telegram files itself.** It needs the bot token, which only the engine
  holds. Rejected.
- **A built-in table of models that read images.** A wrong entry either fails every call that
  holds an image or sends images to a model that cannot read them, and no provider lists image
  input per model id. Rejected.
- **Keep image bytes for the session.** It holds up to 20 MiB per message in memory, or in
  `agent.sqlite` for 90 days, for follow-ups the owner can answer by sending the image again.
  Rejected.
- **Let a message with images join a running turn.** Its limits and its model would be checked
  after the turn's model calls began, and a refusal would end a turn the owner did not start with
  it. Rejected.
- **Take every waiting message's images in one turn.** Twenty messages of 4 images each hold
  400 MiB, and one request past a provider's size limit fails. Rejected.
