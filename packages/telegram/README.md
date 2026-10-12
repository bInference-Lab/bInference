# @binference/telegram

## Purpose

The Telegram channel for the owner's own BotFather bot. Every update is screened and stored before
Telegram learns it arrived, so a crash never loses or repeats one. The owner pairs with a
single-use start code, and only the owner's numeric Telegram id counts after that; groups stay
off. A message that looks like a recovery phrase, a private key or an owner key is deleted unseen
and answered with a warning. Long polling runs in a worker thread, one poller per bot token.

Confirmation cards go to the owner's chat in Telegram's HTML, with every value from outside
escaped, and Confirm and Cancel buttons whose data is a random reference. The engine checks who
pressed and stores the answer before Telegram hears back; the first answer, on any surface, turns
every copy into its receipt. One throttler per bot token paces the bot by Telegram's limits and
waits out every 429, pausing only the chat Telegram named. A confirmed paper intent's card becomes
the receipt of its paper fill.

The owner's fast commands (`/balance`, `/positions`, `/orders`, `/cancel`, `/freeze`, `/rescue`,
`/paper`, `/status`, `/limits`, `/lang`, `/help`) are answered by the engine's code, never by a
model. Each runs its operations through the engine as the owner on Telegram, so a `/freeze` is
journaled and announced as made from Telegram, and `/rescue` opens the rescue card while
everything is frozen. Their menu is registered in English and Chinese. The engine's notices,
such as a limit change that waits ("Not you? Cancel now") or a freeze, reach the owner's chat in
the owner's language.

Any other message from the owner goes to the agent: a paste Telegram split, or an album, goes as
one message, with at most 4 photos. While the agent works, one status message shows how long, or
what it has written so far; its answer arrives as new messages, which notify, and the status
message goes away. The agent's words always show as text, never as markup. A status message's
edit gives way to answers and cards when Telegram asks the bot to wait.

## API

| Export                         | What it does                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `createTelegramIngress`        | Screens and stores each update, then handles it; `resume` handles what is left |
| `UpdateIntake`                 | Where updates come in: long polling and a webhook relay both feed it           |
| `runPolling`                   | Long-polls one bot from a worker thread, under the token's lease               |
| `createBotApiFetch`            | grammY's `fetch` over the Http port, so every Bot API call names binference    |
| `createPollerLeases`           | One poller per bot token in the process                                        |
| `openPollWorker`, `pollWorker` | The poll worker thread and its entry                                           |
| `checkBotToken`, `BotAccount`  | Checks a bot token with `getMe` and answers the bot it opens                   |
| `issueStartCode`               | A single-use `t.me/<bot>?start=<code>` link; only the code's hash is stored    |
| `OwnerUpdate`, `ChatUpdate`    | Updates in binference's own shape                                              |
| `createBotThrottlers`          | One throttler per bot token, installed on every grammY `Api` of the token      |
| `createTelegramCards`          | Shows card versions, settles them into receipts, takes the owner's presses     |
| `CardAnswers`                  | The engine's side of a card press: checks the presser, stores the answer first |
| `createFastCommands`           | Answers the owner's fast commands without a model and registers their menu     |
| `OwnerCalls`                   | The engine's side of a fast command: runs its operations for the owner alone   |
| `createNoticeOutbox`           | Sends the engine's notices to the owner's chat or agent topic, never twice     |
| `createChatIntake`             | Batches the owner's other messages and posts them to the agent with photos     |
| `createChatReplies`            | Shows the agent's replies: a refreshed status message, then the answer         |
| `@binference/telegram/testing` | Contract suites and fakes of the ports, and `createFakeBotApi`                 |

`createFakeBotApi` is a synthetic Bot API for tests: updates in, messages, edits and button
answers out, with Telegram's checks on HTML, lengths and callback data, and topics in private chats
for a bot made with `{ hasTopics: true }`.

## Example

```ts
import { createCardPresses } from "@binference/engine/surfaces";
import { Api } from "grammy";
import {
  createBotApiFetch,
  createBotThrottlers,
  createPollerLeases,
  createTelegramCards,
  createTelegramIngress,
  pollWorker,
  runPolling,
} from "@binference/telegram";

// Every Bot API call goes out through binference's outbound HTTP, which names binference.
const api = new Api(token.reveal(), { fetch: createBotApiFetch(http) });
createBotThrottlers({ clock, logger: logger.child("telegram") }).install(api);
// Read on each message, so a change of owner.locale in config.json5 applies to the next one.
const display = () => ({ locale: settings.owner.locale, timeZone: settings.owner.timezone });
// The engine's side of each press: the owner's only, stored through the confirmations.
const answers = createCardPresses({
  intents: stores.intents,
  answer: engine.answer,
  ownerId: async (call) => (await owners.get(call))?.userId,
  chains,
});
const cards = createTelegramCards({
  api,
  owners,
  copies: stores.cardCopies,
  answers,
  logger: logger.child("telegram"),
  display,
});
const ingress = createTelegramIngress({
  api,
  stores: { inbox: stores.inbox, access: stores.access, owners },
  clock,
  logger: logger.child("telegram"),
  display,
  onOwnerUpdate: async (update, call) =>
    update.kind === "callback" ? cards.press(update, call) : forwardToEngine(update, call),
});
await ingress.resume({ signal });
await runPolling(
  { worker: pollWorker, token, http, leases: createPollerLeases(), intake: ingress, clock, random },
  { signal },
);
```
