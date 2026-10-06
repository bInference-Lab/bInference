# @binference/telegram

The Telegram channel for the owner's own bot: durable update intake, owner pairing by start code,
and secret screening.

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- Updates enter only through `UpdateIntake.receive`. Long polling and a webhook relay both feed
  it, and acknowledge an update to Telegram only after `receive` resolves: it resolves once the
  update is stored in the inbox under `tg:<bot id>:<update id>`.
- Screening runs before anything stores, logs or hands on an update. A text that looks like a
  secret never reaches the inbox, a log, an error or the agent: the inbox keeps the update's ids
  only, and the owner's message is deleted with a warning.
- Only the owner's numeric Telegram id, in the owner's private chat, counts. Groups, channels,
  bots, posts on behalf of a chat and every other person are ignored. Before an owner is bound,
  only a typed `/start <code>` does anything.
- The bot token is a `Secret`. It reaches grammY and the poll worker only. A grammY error never
  becomes an error's cause: its request URL holds the token and its payload holds chat text.
- Telegram names an update's chat message `message`, which the lint rule against reading error
  messages also matches. Only `src/updates/chat-update.schema.ts` reads it; everything else uses
  binference's `ChatUpdate`.
- Every word the bot sends is a message key under `telegram.` in `@binference/i18n`, in the
  owner's language, or else in the language of the sender's Telegram app.
- Its public API is what `src/index.ts` exports. The `OwnerStore` contract suite and its fake live
  behind `src/testing.ts` (`@binference/telegram/testing`). Every export carries TSDoc.
- Tests answer Bot API calls with the in-memory Bot API in `src/testing/fake-bot-api.ts`, through
  grammY's `fetch` option: no network. Worker tests start `src/testing/fake-api.worker.ts` with
  `execArgv` set to run the TypeScript source, and close every worker they start.
