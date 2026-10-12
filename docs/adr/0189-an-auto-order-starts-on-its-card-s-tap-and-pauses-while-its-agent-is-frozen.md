# 0189. An auto order starts on its card's tap and pauses while its agent is frozen

Status: Amended by 0190

Accepted by the owner on 2026-10-12.

## Context

An auto order is confirmed once with a card, and each fill then runs inside its bounds without one
([decision 0004](../DECISIONS.md#d0004), [ARCHITECTURE.md section 9](../ARCHITECTURE.md#section-9)).
A cancel brakes, with no card ([spec 1](../specs/protocol.md) section 7.5), and a freeze pauses
auto orders ([ARCHITECTURE.md section 11](../ARCHITECTURE.md#section-11)). The specs leave open:

- **The card.** A card belongs to an intent ([spec 3](../specs/database.md) section 2.3): its
  versions, its terms hash, its timer, the copies on each surface and the confirmation all hang on
  `cards.intent_id`. An order has none of these of its own.
- **The pause.** `orders.state` lists no paused state, so a frozen agent's orders stay `active`,
  and every reader of active orders would have to check the freeze itself.
- **The mode.** An exit order belongs to its position, live or paper (spec 1, section 8.2), but
  `orders` stores no mode. An order confirmed on a paper card would fill live after a live switch.
- **The rules of `order/create`.** No row says what is refused, which kinds run today, or what a
  buy's size means.
- **The expiry notice** (`notice.orderExpiring`) has no time.

## Decision

- **The card is an `autoOrder` intent.** `order/create` stores the order `awaiting_confirmation`,
  then an intent of the new kind `autoOrder` under the same agent and wallet, in the agent's mode,
  with the proposal's outside-content mark. Its request names the order; its quote holds the order's
  terms with every default filled, so the card's terms hash binds them. It has no policy, venue,
  risk or simulation step of its own and never passes the auto test, so it always opens one card
  (`card.order.action`), whatever the mode or the mark; the card lasts 10 minutes. A locked engine
  takes its tap: it signs nothing.
- **Active only on the tap.** On the Confirm, one write moves the order to `active` and keeps the
  card that confirmed it, and only when that intent holds a confirmation of that card and the agent
  is not frozen, checked inside the write; the intent then moves from `confirmed` to `reconciled`.
  A card that ends otherwise ends the order: Cancel, a cancel of the intent or a freeze `cancelled`,
  the card's timer `expired`. The engine follows each answer at once and checks every waiting order
  on a 10-second timer, which also finishes a tap a stop interrupted.
- **Paused.** `orders.state` gains `paused`. The freeze's own write moves the frozen agents' active
  orders to `paused` and cancels those still waiting for their card. The unfreeze's write moves them
  back to `active`, or to `expired` once past their expiry. A paused order never fills; a cancel and
  its expiry still end it.
- **The mode stays.** An order keeps the mode of its agent when it was created (`orders.paper`), and
  its fills run in that mode only.
- **What `order/create` refuses.** An unknown or archived agent, a frozen one (`agent.frozen`), a
  wallet that is not the agent's, a token the registry's chains do not hold, the chain's coin as the
  token, an expiry not in the future, a price, worst price or size of zero, a trailing distance of 0
  or 100%, a share above 100%, and a side its kind contradicts: take-profit, stop-loss and trailing
  orders sell. A limit buy takes its size in dollars (`{ usdMicros }`); base units and a share of a
  balance stay refused for buys until a decision says what they spend. DCA and copy orders are
  refused with `order.kind_unavailable` until their watchers run. Each other refusal is
  `protocol.bad_args`, and none stores anything.
- **Defaults.** Absent `expiresAt` is 30 days after creation; absent `maxFills` is one fill for a
  limit, take-profit or stop-loss order and no limit for a trailing stop, which runs until it ends.
- **Cancel.** `order/cancel` ends an order waiting for its card, active or paused, at once and with
  no card, and cancels its intent and card when it waits. The owner's surfaces and the agent runtime
  cancel any order; a client with `propose` alone cancels only the orders it proposed. An order
  already ended is `order.wrong_state`.
- **Expiry notice.** `notice.orderExpiring` goes once, 24 hours before an active or paused order
  expires (`orders.expiry_noticed_at`), through the notice outbox.
- **Exit orders.** One write ends every other active or paused exit order of the position (wallet,
  token, mode) with `position_closed`, for the fill that empties it.

## Consequences

- Every card surface (Telegram, the console, the CLI, the Mini App) confirms an order as it
  confirms an intent, with the same version and hash checks, and a freeze's cancel of unsigned
  intents also ends the orders waiting for them.
- `orders` gains `paper`, `intent_id`, `expiry_noticed_at` and the `paused` state; spec 1's
  `OrderView` gains `intent`, `paper`, `outsideContent` and `endReason`, and `OrderState` and
  `IntentKind` a value each, all additions within protocol version 1.
- Spec 6 gains the `autoOrder` kind, its `confirmed` to `reconciled` row and invariant 14 (no order
  is active without a confirmation of its card, and a frozen agent has none); spec 4 the header's
  verb and the condition line of section 3.8.
- The watchers read `active` orders only, so a frozen agent's orders cannot fire.
- A buy order sized in base units or by share waits for a later decision.

## Alternatives

- **Cards of their own for orders.** A second card table, timer, hash and answer path for every
  surface. Rejected: the same checks twice.
- **A pause flag beside `active`.** Every watcher and fill would check the freeze too, and one that
  forgets fills while frozen. Rejected.
- **The agent's current mode at each fill.** A stop-loss confirmed on a paper card would sell real
  tokens after a live switch. Rejected.
- **Accept DCA and copy orders now.** They would sit `active` and never fill, while the owner
  believes them running. Rejected.
