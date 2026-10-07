# @binference/telegram

The Telegram channel for the owner's own bot: durable update intake, owner pairing by start code,
secret screening, confirmation cards and their receipts, and one throttler per bot token.

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
- Every word the bot sends is a message key in `@binference/i18n`: `telegram.*`, and the card,
  receipt and reason messages the engine's card lines name. Cards follow the owner's language;
  ingress replies follow it too, or else the language of the sender's Telegram app.
- Messages go out in Telegram's HTML only as `src/cards/card-html.ts` builds them: every value from
  outside (token symbols and names, the agent's reason, venue and client names) goes through
  `displayOutsideText` of `@binference/i18n`, and each line is escaped whole with `escapeHtml`
  after it is filled in.
  Never build HTML from a value.
- Card buttons carry `bnf1:c:<y|n|d>:<ref>`, and only `cardCallbackSchema` reads it. Any other data
  does nothing. The engine checks the presser and stores the answer through `CardAnswers`; the
  press is answered only after `answer` resolves.
- Every grammY `Api` the package calls has its token's throttler installed
  (`createBotThrottlers().install(api)`). It paces each chat, bounds each attempt to 30 seconds
  and owns every 429 wait, so callers pass only a signal and never retry a 429 themselves.
  `getUpdates` passes through: the poller owns its waits.
- Its public API is what `src/index.ts` exports. The contract suites of `OwnerStore`,
  `CardAnswers` and `CardCopyStore`, with their fakes, live behind `src/testing.ts`
  (`@binference/telegram/testing`). Every export carries TSDoc.
- Tests answer Bot API calls with the synthetic Bot API `createFakeBotApi` (in `src/testing/`,
  exported from `@binference/telegram/testing`), through grammY's `fetch` option: no network. It
  holds updates under Telegram's offset rules, presses buttons as `callback_query` updates, parses
  HTML as strictly as Telegram, keeps each message with its buttons through every edit, and takes
  one answer per press. Worker tests start `src/testing/fake-api.worker.ts` with `execArgv` set to
  run the TypeScript source, and close every worker they start.
