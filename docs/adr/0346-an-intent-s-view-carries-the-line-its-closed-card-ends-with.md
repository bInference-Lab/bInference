# 0346. An intent's view carries the line its closed card ends with

Status: Accepted

Accepted by the tech lead on 2026-11-03.

## Context

[Spec 4](../specs/cards-and-messages.md) section 3.5 turns every copy of a card into its receipt
once the card closes: how it closed, then what followed, a paper fill, what it took effect as, or
how it ended on chain with a link to the transaction. The engine draws that line for Telegram's
copies from the intent's history, transactions, bridge rows and the registry's explorers. The
protocol carries it only for bridges, as `IntentView.bridgeReceipt`
([spec 1](../specs/protocol.md), section 8.3). The console and terminal chat have no chain registry, so they cannot draw a trade's, a send's, a
stake's, a launch's or an identity's receipt, and the console drops a card once it is answered.

## Decision

- **`IntentView.receipt`**, an optional `CardLineView`: the line every copy of the intent's closed
  card ends with, drawn by the same engine code as Telegram's copies (`settledAfterOf` and
  `receiptLine`), its assets in the view's `assets`. `intent/get`, `intent/list`, `intent/confirm`
  and `intent/deny` fill it. It is absent while the card is open, for an intent with no closed
  card, and for a confirmed paper intent until its fill is recorded.
- **Every surface shows it in place of the card's buttons.** The console keeps each card it showed
  until a reload and swaps Confirm and Cancel for the receipt line, which follows the intent's
  pushes. Terminal chat prints an intent's receipt line as it moves, each line once.
- **`bridgeReceipt` stays for protocol version 1**, beside `receipt`, which says the same for a
  bridge. The next protocol version drops it; until then the engine fills both.

## Consequences

- The console and terminal chat show the same receipts Telegram does, a link to each transaction
  included, without a chain registry of their own.
- `intent/list` reads each listed intent's closed card once more: an intent whose card never
  closed costs nothing more.
- Auto trades have no card, so they get no `receipt`; their receipt stays a notice.

## Alternatives

- **One field per kind, as `bridgeReceipt`.** Every new kind would add a field and a surface
  change. Rejected.
- **Let each surface draw the receipt from the intent's outcome.** Each would need the chain
  registry's explorers and would draw it its own way. Rejected: the engine draws it once.
- **A receipt push.** A page opened after the card closed would never see it.
