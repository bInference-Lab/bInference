# @binference/telegram

The Telegram channel for the owner's own bot: durable update intake, owner pairing by start code,
and secret screening.

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- Screening runs before anything stores, logs or hands on an update. A text that looks like a
  secret never reaches the inbox, a log, an error or the agent: the inbox keeps the update's ids
  only.
- Only the owner's numeric Telegram id counts; a username is never trusted. The first person to
  send a valid start code becomes the owner, and the binding stays.
- Telegram names an update's chat message `message`, which the lint rule against reading error
  messages also matches. Only `src/updates/chat-update.schema.ts` reads it; everything else uses
  binference's `ChatUpdate`.
- Its public API is what `src/index.ts` exports. The `OwnerStore` contract suite and its fake live
  behind `src/testing.ts` (`@binference/telegram/testing`). Every export carries TSDoc.
- Tests build updates in the Bot API's shape with `src/testing/update-fixtures.ts`.
