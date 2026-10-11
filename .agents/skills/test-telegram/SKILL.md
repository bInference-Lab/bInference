---
name: test-telegram
description: Proves what the owner sees and taps in Telegram, first on the synthetic Bot API in tests, then on a live test bot before a release that touches ingress. Use when a change reaches the telegram package, cards, notices, fast commands or pairing.
---

# Test Telegram

The owner's Telegram chat is a key: a tap there confirms a trade. Every change to what the bot
reads or sends is proven on the synthetic Bot API in CI. A release that changes ingress (polling,
the webhook, pairing, screening, callbacks) also gets one run on a live bot.

## 1. The synthetic Bot API

`createFakeBotApi()` from `@binference/telegram/testing` answers grammY in memory, through its
`fetch` option or as the `Http` port. It behaves like Telegram where it matters to us:

- updates wait under Telegram's offset rules until a `getUpdates` passes them (`push`, `pending`);
- a button press arrives as a `callback_query` (`press`), and each press takes one answer;
- HTML is parsed as strictly as Telegram does, with the 4,096-character and 64-byte callback
  limits;
- each message keeps its buttons through every edit (`messages`, `edits`, `deleted`, `answers`);
- `failNext(method, failure)` makes the next call refuse with a status and `retry_after`, fail
  before it reaches Telegram (`network`), or succeed and lose its answer (`lostAnswer`).

## 2. Pick the test

| What changed                               | Where to prove it                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| A card, a receipt, a notice text           | the module's test and its `.zh.test.ts`, then the message keys in `i18n`      |
| A fast command or its button               | `packages/telegram/src/commands/`, then `compose-commands.test.ts` in `cli`   |
| Update intake and the poll worker          | `packages/telegram/src/updates/` and `polling/`, with the real worker started |
| Pairing, the owner check, secret screening | `pairing/`, `ingress/`, `screening/`                                          |
| A card from proposal to tap to fill        | `packages/cli/src/compose/compose-telegram.test.ts`, `mcp-paper-swap.test.ts` |
| Delivery after a lost answer or a 429      | `notices/` with `failNext`, then `compose-notices.test.ts`                    |

Assert what a person sees: the text a reader saw (`sent()`), the buttons, the edit, the deletion of
a pasted key, the answer to a press. Test a forged press too: another user, a group chat, data that
is not ours. Each must do nothing.

```sh
pnpm vitest run packages/telegram/src --maxWorkers=2
pnpm vitest run packages/cli/src/compose/compose-telegram.test.ts --maxWorkers=2
```

## 3. The live run before a release

Only for a release that touches ingress, and only by a maintainer with a test bot:

1. A bot made for testing at BotFather, and a Telegram account that is not a real owner's. The
   token goes into the keychain or a secret source of `config.json5`, never into a file in the
   repo, a shell history or a log.
2. A scratch state folder (`BINFERENCE_HOME="$(mktemp -d)"`) and an agent in paper mode. No real
   wallet, no funds.
3. Set up, start and pair from the printed start link. Then check, in English and in Chinese:
   - the command menu, and each fast command's reply;
   - a paper swap's card, its tap, the receipt, and a tap after the card expired;
   - a text shaped like a private key, deleted at once with a warning;
   - a message from a second account and from a group, both ignored;
   - a new pairing with `binference telegram pair`, and the note the first owner gets.
4. Stop the engine and check that nothing still polls the bot. Revoke the test token at
   BotFather if it was shown anywhere.

Write down what you saw on screen, step by step. A log line is not proof that a person saw it.

## 4. Report

The tests you ran and what they assert. For a live run: the version, each check of step 3 with
what the chat showed, and the cleanup. Leave out tokens, ids of real accounts and chat text that is
not from the test.
