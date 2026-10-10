# 0139. The owner binding and the card copies live in engine.sqlite

Status: Accepted

## Context

`binference start` runs the owner's bot ([decision 0138](../DECISIONS.md#d0138)). The bot reads
who owns the install, the owner binding of the start code, and keeps where each card version was
posted, so its copies become its receipt. Both lived only in memory, so a restart forgot the
pairing. A start code works once, and `binference init` makes one only for a folder it sets up, so
after the first restart nobody could pair again, and the notices waited in the outbox. The
database spec has `cards` with their callback references and `card_messages`, but no table for the
owner binding, and `@binference/store` cannot import the ports of `@binference/telegram`.

## Decision

- `OwnerStore` and `CardCopyStore`, with `OwnerBinding`, `CardCopy`, their schemas, contract suites
  and fakes, are store ports of the engine (`@binference/engine/surfaces`).
- Migration 0019 adds `telegram_owner`, one row with `id = 1`: `user_id`, the owner's numeric
  Telegram id, and `paired_at`. The SQLite owner store reads and writes that row; the SQLite card
  copy store keeps each copy in `card_messages` under the card version its callback reference
  names. Pairing and card copies survive a restart.
- `binference telegram pair` asks the engine over IPC, as the owner, for a fresh single-use start
  code, valid 10 minutes, and prints its link once. The owner key is not needed. The binding in
  effect stays until the new code pairs: then the new account becomes the owner, and the chat of
  the one it replaced gets a message that it no longer controls the bot, with "Not you? Freeze
  now." and the command that freezes.

## Consequences

- The owner pairs once and stays paired across restarts, the background service's logins among
  them; a card shown before a restart still becomes its receipt after it.
- A lost Telegram account, or a new one, is paired again from the machine without setting the
  folder up again.
- Whoever holds a start code can take the bot until it expires or is used, as with the code of
  `binference init`; the code goes only to the owner's terminal over IPC, is never stored, and the
  chat it takes over from is told at once.
- The old chat hears of the change from the bot itself, not through the outbox, which sends only
  to the owner in effect.

## Alternatives

- **The owner's numeric id in config.json5.** A file any program of the account can edit would name
  who controls the bot; the spec trusts only the start code.
- **A key of the `meta` table.** The owner binding is a record with its own time, not a fact about
  the database.
- **Keep both in memory.** Every restart would end the pairing, with no way back short of setting
  the folder up again.
- **Remove the old binding at `binference telegram pair`.** The bot would answer nobody until the
  new code is used, and a code that is never used would leave the owner without a bot.
