# 0345. The console shows the agent's launch draft and its picture, read-only

Status: Accepted

Accepted by the tech lead on 2026-11-03. Owner ruling on Start, 2026-11-03.

## Context

[Decision 0285](0285-the-agent-drafts-a-token-launch-and-the-owner-starts-it-in-telegram.md) lets
the agent draft a token launch, which only the owner's Start tap in Telegram's private chat
proposes. Its consequences say the console shows no draft yet, and that a later task gives it the
same Start. The console's chat shows the agent's questions
([decision 0248](0248-the-console-reads-the-agent-s-open-question-with-chat-openquestion.md)) and
cards, but not a draft: `chat/launchDraft` carries only the draft's id and end, and no operation
reads a draft's lines or its picture
([decision 0286](0286-a-launch-draft-s-picture-is-a-photo-from-the-owner-s-own-chat.md)). A push
reaches only a page open when it goes out. A frame holds at most 1 MiB, and a picture up to 5 MiB.

## Decision

- **Read-only, Start in Telegram (owner ruling, 2026-11-03).** The console shows the whole draft
  and its picture, with no Start and no Drop, and one line saying to start it from the draft in
  Telegram. This replaces 0285's line that a later task gives the console the same Start; the
  owner's Start in the private chat stays the one proposal a draft makes.
- **`launch/openDraft`**, scope `read`: `{ agent }` → `{ draft? }`, the agent's open draft as
  `{ draft, expiresAt, lines, assets, picture? }`, or none once it ended or its time is up. `lines`
  are the `CardLineView`s Telegram's message shows between its header and footer, drawn by the
  engine's one draft drawing, with their `assets`; `picture` is `{ bytes }`, the size of the
  owner's photo the draft holds, absent for a picture link.
- **`launch/draftPicture`**, scope `chat`: `{ agent, draft, offset? }` → an `ImagePart`, as
  `inbox/readImage` answers: at most 512 KiB of the photo's bytes in base64 from `offset`, with
  where the next part starts. A draft no longer open, or one without a photo, is
  `image.not_found`. Only a surface that holds the owner's chat reads the owner's photo.
- **The console** reads the draft when the chat opens, at each `chat/launchDraft` and
  `chat/launchDraftClosed` push, and after a gap in the agent's chat topic. It shows the picture
  from its bytes alone, with the type its first bytes name (PNG, JPEG or WebP; any other shows no
  picture), never from a URL, and only within the 5 MiB the draft took. Once the draft closes, the
  draft stays with the line of how it ended until the next draft or a reload.
- The words are new `console.draft.*` keys in both languages.

## Consequences

- An owner sees the agent's draft and its picture in the console, as Telegram shows them, and
  starts it in Telegram.
- The protocol gains two operations. No MCP tool maps them.
- The Mini App, which is the console, shows the draft the same way.

## Alternatives

- **A Start in the console.** Not chosen by the owner: the narrow exception of 0285 stays one tap
  in one chat.
- **The draft's lines on the `chat/launchDraft` push.** A page opened after the draft would show
  nothing, as 0248 found for questions.
- **The picture inline in `launch/openDraft`.** A frame holds at most 1 MiB, and a picture up to
  5 MiB.
- **The picture through a URL.** Rejected by the lead: a URL works as a capability, and the console
  renders images only from bytes it holds.
