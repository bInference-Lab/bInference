# @binference/telegram

## Purpose

The Telegram channel for the owner's own BotFather bot. Every update is screened and stored before
Telegram learns it arrived, so a crash never loses or repeats one. The owner pairs with a
single-use start code, and only the owner's numeric Telegram id counts after that; groups stay
off. A message that looks like a recovery phrase, a private key or an owner key is deleted unseen
and answered with a warning. Long polling runs in a worker thread, one poller per bot token.

One throttler per bot token paces the bot by Telegram's limits and waits out every 429, pausing
only the chat Telegram named.

## API

| Export                             | What it does                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `createTelegramIngress`            | Screens and stores each update, then handles it; `resume` handles what is left |
| `UpdateIntake`                     | Where updates come in: long polling and a webhook relay both feed it           |
| `runPolling`                       | Long-polls one bot from a worker thread, under the token's lease               |
| `createPollerLeases`               | One poller per bot token in the process                                        |
| `openPollWorker`, `pollWorker`     | The poll worker thread and its entry                                           |
| `issueStartCode`                   | A single-use `t.me/<bot>?start=<code>` link; only the code's hash is stored    |
| `OwnerStore`, `ownerBindingSchema` | Which Telegram user owns the install                                           |
| `OwnerUpdate`, `ChatUpdate`        | Updates in binference's own shape                                              |
| `createBotThrottlers`              | One throttler per bot token, installed on every grammY `Api` of the token      |
| `CardAnswers`                      | The engine's side of a card press: checks the presser, stores the answer first |
| `CardCopyStore`, `cardCopySchema`  | Where each card version was posted, so every copy can become the receipt       |
| `@binference/telegram/testing`     | Contract suites and fakes of the three ports, and `createFakeBotApi`           |

`createFakeBotApi` is a synthetic Bot API for tests: updates in, messages, edits and button
answers out, with Telegram's checks on HTML, lengths and callback data.

## Example

```ts
import { Api } from "grammy";
import {
  createBotThrottlers,
  createPollerLeases,
  createTelegramIngress,
  pollWorker,
  runPolling,
} from "@binference/telegram";

const api = new Api(token.reveal());
createBotThrottlers({ clock, logger: logger.child("telegram") }).install(api);
const ingress = createTelegramIngress({
  api,
  stores: { inbox: stores.inbox, access: stores.access, owners },
  clock,
  logger: logger.child("telegram"),
  display: { locale: config.owner.locale, timeZone: config.owner.timezone },
  onOwnerUpdate: forwardToEngine,
});
await ingress.resume({ signal });
await runPolling(
  { worker: pollWorker, token, leases: createPollerLeases(), intake: ingress, clock, random },
  { signal },
);
```
