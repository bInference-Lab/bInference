# 0286. A launch draft's picture is a photo from the owner's own chat

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0236](0236-only-the-owner-starts-a-token-launch-with-a-picture-of-their-own.md) reads a
launch's picture only from an upload the proposer's own credential made on the engine's upload
shelf. The owner's photos in Telegram reach the agent as `tg:<file id>` names in the owner's
messages (decision 0178), which no upload shelf holds. A launch drafted in a chat
([decision 0285](0285-the-agent-drafts-a-token-launch-and-the-owner-starts-it-in-telegram.md))
needs its picture from that chat, and must not take a picture the owner did not send.

## Decision

- **A photo of the owner's own message.** A draft for a launchpad that uploads or writes the
  picture names one image of one of its agent's stored messages from the owner: an
  `inbox/message` from Telegram whose images hold that `tg:<file id>`. Any other message or name
  is `image.not_found`. A draft for a launchpad that takes a picture link names none, and its
  `image` is `none`.
- **Read once, at the draft.** The engine reads the photo's bytes once through the bot when the
  draft is made, and takes it as a launch takes an upload: a PNG, JPEG or WebP by its first
  bytes, at most 5 MiB (else `image.format`, `image.too_large` or `image.unreadable`). For a
  launchpad that writes it into its create call, it must tell its width and height and fit
  beside the words, at most 1,024 pixels each way, as decision 0279 says (else
  `image.unreadable` or `intent.launch_picture_too_large`). The draft keeps the bytes in memory
  and shows their format, size and the first 16 digits of their SHA-256.
- **The owner's upload at Start.** At the Start press, the engine puts those bytes on the upload
  shelf held by the pressing owner's Telegram credential, and the launch names that upload, so it
  reads its picture under decision 0236's rule: exactly the bytes the draft showed, never a later
  read.

## Consequences

- A photo the owner sends with a launch request in Telegram becomes the launch's picture with no
  other upload step. Telegram compresses a photo to JPEG; a picture sent as a file keeps its
  bytes, which a launchpad that writes a small picture needs.
- A draft holds at most one picture of at most 5 MiB per agent, for 10 minutes.
- The protocol gains `intent.launch_picture_too_large`.

## Alternatives

- **Read the photo at the press.** The launch could take bytes other than those the draft showed
  if the file changed. Rejected.
- **Let the launch path read `tg:` names.** Every launch would need to know who posted a photo.
  Rejected: the shelf's holder rule stays the one rule.
- **Ask the owner to upload the picture again from the Mini App.** A second step for a picture
  already in the chat. Rejected.
