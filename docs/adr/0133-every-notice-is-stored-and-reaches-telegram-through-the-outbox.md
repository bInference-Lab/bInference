# 0133. Every notice is stored and reaches Telegram through the outbox

Status: Accepted

## Context

The engine publishes the owner notices of [spec 4, section 4](../specs/cards-and-messages.md#section-4)
as `notice/new` pushes only, and the Telegram channel relays them from memory. A notice the Bot API
refuses, one published before the owner pairs, and one waiting when the engine stops are lost. A
client that comes back after a `resync` refetches with the topic's list operation
([spec 1, section 6](../specs/protocol.md#section-6)), and the `notice` topic has none. The
[database spec](../specs/database.md#section-2-7) already holds a `notices` table, kept 90 days,
and an `outbox` whose rows are `queued`, `sent`, `unknown_after_send` or `failed`; nothing writes
either.

The Bot API (version 10.3, core.telegram.org/bots/api) answers every request with a JSON object
whose `ok` is false when the request was unsuccessful, with an `error_code` and a `description`. A
flood answer carries `parameters.retry_after`, the seconds left before the request can be repeated.
`sendMessage` has no parameter that makes a repeated request count once, and no method lets a bot
read the messages it sent. The bot FAQ allows about one message a second in a chat and answers 429
beyond it.

The owner decided on 2026-10-10 that this is built before the alpha, so that no security notice is
lost.

## Decision

- **One write path.** Every `notice.*` the engine's one `publish` carries is stored before any
  surface sends it: an `ntc_` id, its time, the notice with the intent it names (a new
  `notices.intent_id`), its kind and level, and in `delivered` the state of its delivery to each
  chat surface the install runs. Each such surface gets an `outbox` row for it in the same write.
  The `notice/new` push carries the notice's `id` and `at`. A notice's kind is its name (`lowGas`
  for `notice.lowGas`); its level is `critical` when its English message opens with the red circle
  icon, `warning` with the warning sign, and `info` otherwise.
- **Moves.** A delivery moves to `unknown_after_send` in the store before the Bot API call, then to
  `sent` once Telegram took every part of the message. Each move changes the outbox row and the
  notice's `delivered` in one write.
- **A refusal keeps the notice.** Telegram answered with an error, so it sent nothing: the delivery
  goes back to `queued` with its next time. A 429 waits the `retry_after` it names, once the bot's
  throttler has waited out its five minutes. A 403 (the owner blocked the bot), a 401 or 404 (the
  token), a 5xx, and a connection that never opened (no DNS answer, refused, no route, a connect
  timeout) wait 5 seconds after the first attempt, 25 seconds after the second, 2 minutes after the
  third and 10 minutes after each later one. Any other 4xx, such as a 400, is `failed`: Telegram
  refuses the same message again.
- **An unknown outcome is never sent again.** A `sendMessage` that timed out or lost its connection
  after the request left, a call the engine stopped in the middle, or a crash between the send and
  its record leaves the delivery `unknown_after_send`. With no idempotency key and no way to read
  what it sent, a bot that sends again may post the notice twice, so binference never does by
  itself. The notice stays readable through `notice/list`.
- **Order.** Telegram deliveries go out one at a time, oldest first, in the same line as the cards,
  so a notice never overtakes the card it follows. A delivery that waits holds the ones behind it.
  At start, the deliveries left from before go out first. Before the owner pairs, deliveries wait,
  and the pairing sends them.
- **`notice/list`** (`read`, paging): the notices kept, oldest first; a notice's id as the cursor
  gives those after it. Each carries its `delivered`.
- **Retention.** The store deletes notices older than 90 days with their outbox rows when the
  daily retention job of the database spec calls it.

## Consequences

- No notice is lost to a refusal, a restart or a late pairing. A notice whose send outcome is
  unknown may be missing from the chat; the console and the CLI read it from `notice/list`.
- After a long time unpaired, every notice waiting goes out at the pairing, one a second.
- Every surface that sends notices through the outbox states its own rule for an unknown outcome.
- Per-agent notice settings ([decision 0057](../DECISIONS.md#d0057)) are not built yet: until they
  are, every notice is delivered, and the kind is what they will name.
- The database spec gains `notices.intent_id` (migration 0018), and spec 1 gains `notice/list`
  and the `id` and `at` of `notice/new`.

## Alternatives

- **Send again after a timeout.** Telegram may already show the notice, and nothing tells the bot
  whether it does: the owner reads it twice. Rejected.
- **Keep the relay in memory with retries.** A restart still loses what waits. Rejected.
- **Keep the queue in `notices.delivered` alone.** Finding the waiting deliveries needs the
  outbox's `(state, next_at)` index, and its attempt count. Rejected.
- **A line of its own for notices.** A notice could reach the chat before the card it follows.
  Rejected.
