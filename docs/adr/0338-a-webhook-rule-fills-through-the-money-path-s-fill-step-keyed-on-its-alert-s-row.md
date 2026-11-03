# 0338. A webhook rule fills through the money path's fill step, keyed on its alert's row

Status: Accepted

Accepted by the tech lead on 2026-11-03.

## Context

Spec 6 section 4 runs each accepted alert of an active rule "as an auto order's fill", with
`authorizedBy: { webhookRule, alertId }`. Spec 3 keeps rules in `webhook_rules`, apart from
`orders`, and links an alert to its fill by `webhook_events.intent_id`. The signer already reads
a `webhookRule` authorization: the rule's state, expiry, fills and the terms hash of its card.

The engine's fill code serves auto orders. Two layers matter:

- The money path takes any fill: a `FillProposal` with its authorization, its mode, a check that
  holds the quote to the bounds in the agent's line, and the rolling cap
  (`authorize-simulated.ts`). Nothing in it names an order.
- Around it, the order fills (`orders/fill-*.ts`, about 3,000 lines) size a fill, check it, record
  its skips and notices in `order_fills`, count a paper fill on its order in the fill's own write
  (`IntentStore.transition` with `order`), and pace failures. The executor counts a live fill on
  its order as it settles, resets a leftover approval, and books a late landing, all keyed on
  `{ order }` (six files). The signer holds a live order fill to a grant bound to the fill's own
  terms and size (decisions 0210 and 0211); its `webhookRule` check binds only the rule's card.

An alert's body may have no `id`: a plain-text alert has none (decision 0333), so `alertId` cannot
key a fill. The alert's `webhook_events` row is unique and never reused.

## Decision

- **Keyed on the row.** A rule's fill is authorized by `{ webhookRule, event }`, the alert's
  `webhook_events` row, with `alertId` kept beside it when the body had one. Spec 6 and spec 1
  change their wording to match. The row's `intent_id` names the fill's intent, so one alert has at
  most one fill: a second fill of the same row is refused in the store.
- **The money path's fill step, a runner of its own.** The rule's fills run through the same
  `FillProposal` as an order's: the same sizing of the bounds, the same check in the agent's line,
  the same rolling cap, in the agent's one line of fills. A refactor first moves the sizing and the
  bounds check off `OrderRecord` onto the bounds both share (wallet, mode, token, side, size, spend,
  worst price, slippage, expiry, fills, most fills). Rule fills keep their own records: the skip's
  reason on its `webhook_events` row, the paper fill's count on its rule in the fill's own write,
  and the notices from the same tables as an order's, `{orderKind}` from `fill.webhookRule`.
- **Paper first.** This task builds paper fills. A live rule is refused at `webhookRule/create`
  while live webhook fills are off (decision 0299), and a live rule's fill that reaches the money
  path anyway ends `live_fills_off`, whatever the order switch says. Live webhook fills need their
  own signer grant bound to the fill's terms, as decision 0211 gives orders, and the executor's
  settle, reset and late landing for rules; a later task builds them, with their crash points,
  before the step that turns webhook fills on. Tests show each of the two guards failing alone:
  the money path's, which ends a live rule fill before any signer call, and the runner's, which
  ends a live rule's alert before its fill starts.
- **A line per agent.** A run takes up to 20 waiting alerts, reads each one's rule, and fills each
  agent's alerts in that agent's line, in the order they arrived, with up to four agents at once.
  A fill takes at most its 30-second deadline, so one agent's slow quotes hold only its own alerts,
  and four slow agents at once hold the rest for at most one deadline.
- **Every alert ends.** A fill past its deadline cancels, unsigned, the intent it stored, and its
  alert ends `fill_failed`. An alert whose end cannot keep its rule's notice hour after three tries
  ends without it; one whose rule is gone ends `order_inactive`. An alert whose run fails three
  times ends `fill_failed` and is logged by its row, so it never holds the alerts behind it.
- **The start's repair.** Before anything fills, the start cancels, unsigned, every paper rule fill
  a stop left before its write, so its value leaves the rolling cap, and ends its alert
  `fill_failed`, told once per reason in a row. An alert's row stays its key: a start within its
  minute finds it ended and never proposes a second intent for it.

## Consequences

- Nothing about webhook rules reaches `order/list`, `/orders`, `order_fills` or the order kinds
  of protocol v1.
- The refactor touches the order fills' sizing and check; their tests stay as they are.
- `IntentStore.transition` gains a rule's write beside an order's, in both adapters and the
  contract.
- The second step of live fills (decision 0195) waits for the live webhook task as well. That
  task builds, before any live rule is taken: a grant per fill, bound to the fill's own terms
  hash and to the rule's fills before it, as decision 0211 gives an order's fill; the signer
  holding a rule's fill to that grant and to the fill's size, never to the rule's card alone; the
  executor counting a live fill on its rule as it settles, resetting an approval a fill left
  behind, and booking a fill that lands late; and the crash suite's kill points for rule fills
  between signing, sending and settling.
- Until then a rule's card, the protocol spec and the docs say a rule trades on paper only.

## Alternatives

- **A hidden auto order behind each rule.** Its alerts would trigger an order of a new internal
  kind, so the order fill path, the executor and the signer's fill grant would serve it as they
  are, live fills included, and the change would be about half the size. But the kind would reach
  `OrderView`, `order/list`, `/orders` and the daily summary unless each filtered it out, and
  `webhook_rules` would keep its own copy of the bounds and the fill count, or spec 3 would change.
- **Key on `alertId`.** A plain-text alert has none.
- **Build live webhook fills here.** It doubles the task and its money-path review, and the switch
  that would use them is off until the owner's second step.
