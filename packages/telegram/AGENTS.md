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
  only a typed `/start <code>` pairs anyone, and a typed `/start` alone is answered with how to
  pair; once an owner is bound, nobody else hears from the bot.
- The bot token is a `Secret`. It reaches grammY and the poll worker only. A grammY error never
  becomes an error's cause: its request URL holds the token and its payload holds chat text.
- Telegram names an update's chat message `message`, which the lint rule against reading error
  messages also matches. Only `src/updates/chat-update.schema.ts` reads it; everything else uses
  binference's `ChatUpdate`.
- Every word the bot sends is a message key in `@binference/i18n`: `telegram.*`, the fast
  commands' `cmd.*`, and the card, receipt and reason messages the engine's card lines name. Cards follow the owner's language;
  ingress replies follow it too, or else the language of the sender's Telegram app. The owner's
  language and timezone are read for each message, so a change in config.json5 applies at once.
- Messages go out in Telegram's HTML only as `src/cards/card-html.ts` builds them: each card line
  is filled in as plain text by the engine's `cardLineText`, where every value from outside (token
  symbols and names, the agent's reason, venue and client names) goes through `displayOutsideText`
  of `@binference/i18n`, and then escaped whole with `escapeHtml`.
  Never build HTML from a value. The one other source of HTML is the agent's chat text (decision
  0370): `src/format/rich-html.ts` writes it from the fixed tags of `RichMark` and `RichBlock`
  (`b`, `i`, `s`, `code`, `tg-spoiler`, `pre` with a letters-and-digits `language-` class, `a` with an `http:`
  or `https:` address, `blockquote`) around text it escapes itself. The Markdown reader,
  `@binference/rich-text`, which the console and terminal chat share, makes runs and lines, never
  HTML; a tag the model writes stays text.
- A fast command (`src/commands/`) runs the engine's operations only through the `OwnerCalls`
  port, never a store or a model: the engine runs each for the owner's numeric Telegram id, as the
  owner on Telegram. A command is a message the owner typed: an edit or a forward runs nothing,
  and any other message goes on to the agent's chat. Replies go out as plain text, with no parse
  mode, split at line breaks into messages of at most 4,096 characters (`src/split/`); a value
  from outside in them goes through the engine's `cardLineText`. `/wallet` alone goes as HTML,
  through `sayPhoto` and `sayRich`: lines of `RichRun`s that `rich-html.ts` draws, so each address
  shows in `code` and its explorer page as a link, and a message Telegram cannot parse goes again
  as plain text. Its photos are QR codes `@binference/qr` makes from the addresses the engine
  answers, never from chat text. They and the images the agent made (`chat/images`, read from the
  engine's `image/read`, `src/chat/made-photos.ts`, decision 0392) are the only files the bot
  uploads, read whole into bytes by the fetch layer, at most 10 MB. A refusal is answered with the error message of its code. The menu is registered with
  `setMyCommands` for private chats, in English and in Chinese.
- The engine's notices of spec 4, section 4 go to the owner's chat from the outbox through
  `createNoticeOutbox` (decision 0133), written by the engine's `noticeText` in the owner's
  language and timezone when each goes, as plain text. A delivery is marked `unknown_after_send`
  before its `sendMessage` and never sent again from there: the Bot API has no idempotency key, so
  a send that timed out or lost its answer may already show in the chat. Only a refusal Telegram
  answered, or a connection that never opened (`isUnsent` of `telegram.unreachable`), puts it back
  in the queue: a 429 for its `retry_after`, a 403, a refused token and a 5xx for the backoff of
  `delivery-fate.ts`; any other 4xx fails it. Deliveries go oldest first, a waiting one holds
  the rest, and before the owner pairs they all wait; the ingress's `onOwnerPaired` sends them.
  Where a notice goes is `notice-places.ts` (decision 0186): with `telegram.topicsPerAgent` on and
  `getMe`'s `has_topics_enabled`, the agent's topic, made before the delivery is claimed and kept
  in the `AgentTopicStore`; otherwise the chat, with the agent's name first when the words do not
  name it. A topic refused for good leaves the notice in the chat; a send to a deleted topic
  forgets it and queues the delivery again, since Telegram sent nothing.
- The owner's messages that no fast command answers go to the agent through `createChatIntake`:
  posts within 300 ms of each other become one `chat/post` for the only agent, photos as
  `tg:<file id>`, at most 4 of at most 5 MiB each. An edit, a forward and a post with neither
  text nor a photo are answered at once and go nowhere (decision 0178).
- The agent's replies come from the engine's pushes on its chat topic through `createChatReplies`
  (decisions 0371 and 0375): a turn's status message (`src/chat/status-message.ts`, on the edited
  `src/chat/preview-message.ts`) shows only once a `chat/progress` line arrives, with a fixed
  label or the text written before the latest tool as its headline, and is edited at most once a
  second when that changes; then the answer goes as new messages and the status message is
  deleted once it has shown for 4 seconds. With `telegram.replies.stream` at `partial`
  (`ChatRepliesOptions.replies`, read as each turn starts, decision 0376), the turn's message is
  `src/chat/answer-preview.ts` instead: the answer grows in it from 30 characters and it is edited
  into the answer's first message in place. A `chat/reasoning` push shows as
  `telegram.replies.reasoning` says (decision 0377): a line of the status message, a lane of its
  own in the partial mode (`reasoning-lane.ts`), or a kept message (`reasoning-html.ts`) before
  the answer. Model text goes out as Telegram HTML
  only through `src/chat/chat-html.ts`: every line through `displayOutsideText`, then its Markdown
  drawn by `src/format/rich-html.ts` and split by `src/split/split-rich-lines.ts`, a paragraph
  break preferred, at most 4,000 characters each, tables as fixed-width grids (decision 0374), each
  message rendering its own tags; the status message draws its draft the
  same way (`status-preview.ts`), cut from its start to fit 4,000 characters. A message Telegram
  answers with a 400 it cannot parse (`isEntitiesUnparsed`) goes once more as its plain text, no
  parse mode, and the log names its message id, never its words.
- A turn's pushes show in the order they came, one at a time, through the relay's one line. What
  a tool shows mid-turn (`chat/deposit`) closes the turn's open message first, so what the turn
  writes after it starts a new message below it (decision 0381). A `chat/chart` shows as its text
  from `@binference/chart`, the title in bold (`src/chat/chart-message.ts`, decision 0387):
  Telegram draws no chart. A `chat/credentialRequest` sends where to answer it, the console's
  masked prompt or `binference credential set` (`src/chat/credential-message.ts`, decision 0388):
  the chat never takes a credential.
- A status message's send and edit are previews (`src/chat/preview-sends.ts`): each goes with a
  `previewSignal`, and the throttler drops it rather than queue it behind another call or a wait.
  A dropped preview waits for the next refresh. A first send that may have reached Telegram is
  never sent again, and any failure but a passing one stops the edits for the turn. The typing
  indicator (`src/chat/chat-typing.ts`, decision 0372) goes the same way, every 4 seconds while a
  turn runs; `sendChatAction` also takes no place in its chat's pace. Nothing else is sent as a
  preview. A message of the answer whose send provably never left goes again through
  `resendUnsent`, 3 tries at most (decision 0373); an answer Telegram refuses leaves the status
  message saying so, and a turn that ends with nothing for the owner gets `telegram.chat.noAnswer`.
- A fast command's button carries `bnf1:t:h:<limit>` (a `/limits` button halves that limit) or
  `bnf1:l:s:<en|zh>` (a `/lang` button sets `owner.locale` through `config/change`, decision 0134) or `bnf1:r:<m|t>:<choice>` (a `/replies` button sets one key of `telegram.replies`,
  decision 0377), the only settings the chat changes at once, and only `commandCallbackSchema` reads it.
  `/config` reads the settings through `config/view` and changes any other through
  `config/propose`, whose card applies it on the owner's tap (decision 0393). A press
  goes to the fast commands first, then to the cards. A button never loosens anything.
- A launch draft's buttons carry `bnf1:s:<y|n>:<ref>`, and only `launchDraftCallbackSchema` reads
  it. A press goes to the engine through `LaunchDraftAnswers`, which acts only for the owner's
  numeric Telegram id; the owner's Start is the one proposal the chat makes (decision 0285). The
  draft's words are outside text: every line is drawn with the engine's `cardLineText`, then
  escaped whole.
- Card buttons carry `bnf1:c:<y|n|d>:<ref>`, and only `cardCallbackSchema` reads it. Any other data
  does nothing. The engine checks the presser and stores the answer through `CardAnswers`; the
  press is answered only after `answer` resolves.
- Every Bot API request goes out through binference's outbound HTTP, the `Http` port, so it names
  binference in its user agent and shares its connections: an `Api` takes
  `createBotApiFetch(http)` as grammY's `fetch`, and the poll worker's grammY relays each request
  to the parent, which sends it through the `http` the worker was opened with. grammY's own
  `connection` header and its polyfill signal stay behind.
- Every grammY `Api` the package calls has its token's throttler installed
  (`createBotThrottlers().install(api)`). It paces each chat, bounds each attempt to 30 seconds
  and owns every 429 wait, so callers pass only a signal and never retry a 429 themselves.
  `getUpdates` passes through: the poller owns its waits.
- Its public API is what `src/index.ts` exports. The owner and card copy stores it reads and
  writes, `OwnerStore` and `CardCopyStore`, are store ports of `@binference/engine/surfaces`, with
  their contract suites and fakes in `@binference/engine/testing`. The contract suites of
  `CardAnswers` and `OwnerCalls`, with their fakes, live behind `src/testing.ts`
  (`@binference/telegram/testing`). Every export carries TSDoc.
- Tests answer Bot API calls with the synthetic Bot API `createFakeBotApi` (in `src/testing/`,
  exported from `@binference/telegram/testing`), through grammY's `fetch` option or the `Http` port
  as its `http`: no network. It
  holds updates under Telegram's offset rules, presses buttons as `callback_query` updates, parses
  HTML as strictly as Telegram, keeps each message with its buttons through every edit, and takes
  one answer per press. Worker tests start the poll worker itself with `execArgv` set to run the
  TypeScript source, its requests answered by the fake's `http`, and close every worker they start.
