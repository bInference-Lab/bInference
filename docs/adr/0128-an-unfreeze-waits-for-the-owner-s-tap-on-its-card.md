# 0128. An unfreeze waits for the owner's tap on its card

Status: Accepted

## Context

[Rule 11](../ARCHITECTURE.md#rule-11) and [decision 0089](../DECISIONS.md#d0089) let the CLI, the
console and the Mini App unfreeze, "never a chat message or a card tap", and `safety/unfreeze` took
effect on the call. A freeze of the whole install marked the agents active then: an agent created
afterwards started unfrozen, and the `safety` row's `frozen_at` was never written. Nothing on any
surface read back which agents were frozen, the install's freeze, the rescue under way and the
rescue address in effect together. The owner decided on 2026-10-10.

## Decision

- A freeze of the whole install also marks the install frozen, keeping the time of an earlier
  freeze. While it is, every agent created starts frozen at its creation.
- `safety/unfreeze`, still a `loosen` call, unfreezes nothing on the call. It stores an `unfreeze`
  intent of the owner's and opens its card, which names the agent, or every frozen agent and the
  install. With nothing frozen, it opens no card and answers no intent.
- The owner confirms that card like any card, from Telegram, the console or the CLI, with no owner
  key, and a locked engine takes the tap, since an unfreeze signs nothing. Its card lasts 10
  minutes and never passes the auto test.
- On the tap, one write unfreezes the agents the card named, clears the install's freeze for a
  whole-install unfreeze, moves the intent from `confirmed` to `reconciled`, and appends one
  `unfreeze` ledger entry for each agent and one for the install. `notice.unfrozen` goes out on
  every surface, in English and Chinese.
- While an unfreeze of the same agent, or of the whole install, has not ended, `safety/unfreeze`
  answers it, and applies one a stop left `confirmed`. A freeze cancels a waiting unfreeze of the
  agents it stops, as it cancels any unsigned intent.
- `safety/status` reads, from any surface: every frozen agent with its time, the install's freeze,
  the rescue that has not ended with its state, and the rescue address in effect with a change that
  waits and when it takes effect.

## Consequences

- Rule 11 and decision 0089 change: an unfreeze is opened from the CLI, the console or the Mini
  App, and takes effect only on the owner's tap on its card, which any surface may give.
- A hijacked Telegram account can confirm an unfreeze another surface opened: the risk decision
  0089 already accepted for the Mini App.
- Spec 6 gains the `unfreeze` kind and its `confirmed` to `reconciled` row; spec 4 the card's
  action line, its header verb and `notice.unfrozen`; spec 1 the `{ intent? }` answer of
  `safety/unfreeze` and the new fields of `safety/status`, all additions within protocol version 1.
- The executor never takes an unfreeze: it has no transaction.

## Alternatives

- **Unfreeze on the call, as before.** One call from a stolen console session lifts every brake.
  Rejected.
- **The owner key for an unfreeze.** The key stays offline, so an owner away from it could not
  unfreeze. Rejected.
- **Unfreeze every agent created after a freeze by hand.** A new agent would start trading while
  the owner believed the install frozen. Rejected.
