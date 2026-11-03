# 0342. A live webhook rule fill signs under its own grant and ends its alert as it settles

Status: Accepted

Accepted by the tech lead on 2026-11-03.

## Context

[Decision 0338](0338-a-webhook-rule-fills-through-the-money-path-s-fill-step-keyed-on-its-alert-s-row.md)
built webhook rule fills on paper and listed what live ones need before any live rule is taken: a
grant per fill bound to the fill's terms and to the rule's fills before it, as
[decision 0211](0211-a-live-fill-holds-its-line-while-watched-and-leaves-no-approval-behind.md)
gives an order's fill; the signer holding the fill to that grant and its size; the executor
counting the fill on its rule as it settles, resetting a leftover approval and booking a late
landing; and crash points. The owner set on 2026-10-29 that webhook fills, like DCA and copy
fills, turn on in the second of the two steps of live fills.

A rule differs from an order in three ways that matter here. Its alert is judged once, at the
head of its agent's line, within a minute of its arrival
([decision 0336](0336-a-webhook-alert-fills-only-within-a-minute-of-its-arrival.md)), so nothing
fires it again at the next price. A rule stays `active` while its agent is frozen, and a rotation
drops what its old URL took ([decision 0337](0337-a-webhook-rule-keeps-its-mode-and-drops-the-alerts-its-old-url-took.md)).
Its fill's end is written on its alert's row, which takes one outcome, not on an `order_fills`
row of its own.

## Decision

- **One switch.** A live rule's fill runs only while the engine's switch for live fills is on,
  the switch DCA and copy fills ride; the executor's own switch ends it unsigned too. Both are off
  in every install. `webhookRule/create` takes a live agent's rule only while the switch is on.
  The PR that turns on the first step of live fills splits the switch, so DCA, copy and webhook
  fills stay off until the second; the PR that turns on the second step changes the paper rule
  card's words, which say alert rules trade no live funds yet.
- **The fill's terms.** A rule's fill is authorized by
  `{ webhookRule, event, alertId?, fillsBefore, termsHash }`. Its terms hash is the SHA-256 of a
  tagged, versioned document (`v: 1`, `kind: "ruleFill"`) of the intent, the rule, its confirmed
  card's terms hash, the fills before, the alert's row, the request, the quote and the plan,
  stored as the fill is confirmed. The wallet queue signs only while the fill hashes to it again.
- **The grant and the rule now.** The fill signs under a fill grant whose source is the rule
  (decisions 0210 and 0211): 60 seconds from its confirmation, the network fee cap, at most its
  confirmed quote's input of what it spends, once per rule count in the signer. The engine reads
  the rule again before each signature. It reads as `active` only while the rule is active,
  before its expiry and the alert came to its current URL; as `url_rotated` once a rotation took
  the alert's URL; and as `paused` while its agent is frozen, so a freeze lets only a sale under
  way finish, as it does for an order.
- **The line.** A live rule fill holds its agent's line in the store until its alert ends, and a
  dropped one while it is watched, as an order's does. An alert that reaches the head of its line
  while a live fill of the agent still settles is skipped as `fill_waiting`, as a DCA period is
  ([decision 0246](0246-a-dca-order-buys-once-per-period-and-never-buys-a-missed-one.md)).
- **An alert held by its fill.** Once an alert has a live fill the executor holds, from its
  confirmation on, nothing but that fill's own end ends the alert. The runner looks for the
  alert's own fill first and leaves the alert to it, past its minute, while the engine is locked,
  after the fill's deadline or a fault, and at an entry's third failed run alike. The store
  refuses a skip over such an alert, and a `filled` end written alone must name the alert's own
  fill.
- **Failures.** A rule's failures are counted from its own fills' ends since its last fill, so the
  alerts skipped between them never push one out. After two fills of a rule failed on chain since
  its last fill, its alerts are skipped as `fill_waiting` for 15 seconds after the last failure,
  the wait doubling to 5 minutes. The fifth ends the rule `deleted` in the move that writes it,
  and the owner hears `notice.webhookRuleFailing`, as an order is cancelled (decision 0211).
- **The end on the alert, in the intent's move.** The one writer of intents writes the alert's end
  with the move that ends the fill. The move to `reconciled` writes the alert `filled` and counts
  the fill on the rule, with `notice.fill` in the rule's notice hour; the fill that uses the
  rule's last fill ends the rule `deleted`. A landing on a rule still active or expired counts on
  it, and a count past the rule's most fills adds `notice.orderOverfilled`; one on a rule deleted
  meanwhile writes its alert `filled` and leaves the rule as it was, since a deleted rule never
  moves, so its count keeps what it had. A fill that could not be valued counts at its quote
  after the settle wait with `notice.fillUnvalued`. A lapse ends the alert `fill_lapsed`, a fill
  that failed on chain with its reason, one never signed `fill_failed`, one the queue refused with
  the refusal's reason; the executor's own notice tells the owner of those. A fill the owner
  cancels before it signs ends its alert `owner_cancelled` and its rule `deleted`, as it ends an
  order, and the owner hears `notice.webhookRuleCancelled`. The notice that tells a rule's end goes
  out past its notice hour, since the rule takes no more alerts.
- **A late landing.** A dropped fill ends its alert `stuck_dropped`. When its bytes land within
  the watch, the late landing's write turns that alert `filled` and counts it on the rule, once.
- **A sale stopped halfway.** A rule's sale whose later step can no longer sign resets its
  approval to 0 under its grant, and recovery after a restart finishes or resets it, as an
  order's does (decision 0211).
- **The crash suite** kills `binference start` during a live webhook rule's buy as custody is
  asked to sign, once it signed, once the bytes are stored, while the transaction waits for a
  block, and once a block holds it, in the nightly part of the live fills. A run killed before the
  bytes are stored passes when nothing reached the chain and the alert ended `fill_failed`, since
  an alert is judged once; any other when one transaction reached the chain and the alert counts
  one fill on its rule.

## Consequences

- Live webhook fills are built but off: they turn on with the second step of live fills, in the
  same small PR as DCA and copy fills, on the owner's word.
- `fillsInFlight` counts rule fills, so an agent's live order fills and rule fills hold one line.
- The intent store's move and late landing write a rule fill's skip, a fill of a deleted rule and
  a landing over its `stuck_dropped` skip.
- A rule card for a live agent says it trades live funds with no tap, in English and Chinese.
- The one switch gates every live fill until the first step's PR splits it.
- The signer's rule 5 names a rule as a fill grant's source; the old rule authorization is gone.
- The crash points cover a rule's buy. Those for a rule's two-step sale wait for the PR that turns
  on the second step of live fills, and land before it.
- The reasons `fill_failed` and `fill_lapsed` no longer promise another try: an alert is judged
  once, and an order says it stays active.

## Alternatives

- **Its own switch.** The owner set webhook fills into the second step with DCA and copy fills;
  a third switch would be a step the owner did not ask for.
- **Wait for the line within the minute.** An alert behind a settling fill would fill seconds later
  at a price it did not see, and a held line could hold a burst of alerts; DCA's rule is the
  owner's answer to the same case.
- **Keep the rule active on the owner's cancel.** Each alert is judged once, so nothing fires the
  same fill again; but the owner who cancels a fill no tap started most likely wants the rule to
  stop, and a deleted rule is made again in one card.
- **Key the grant's single use on the alert row.** One alert has one fill already; the rule's
  count is what a second fill under one count would break.
