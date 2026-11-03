# 0337. A webhook rule keeps its mode and drops the alerts its old URL took

Status: Accepted

Accepted by the owner on 2026-11-03, with the fill notices held to five an hour per rule and one
line for the rest.

## Context

Spec 1 section 7.5 and [decision 0299](0299-a-webhook-rule-fills-once-a-minute-unless-it-names-a-rate-up-to-sixty.md)
give a rule's operations: `webhookRule/create` (`admin`) stores the rule and its one card, whose
Confirm makes it `active`; `webhookRule/delete` (`confirm`) and `webhookRule/rotateUrl` (`admin`)
take an active rule or one awaiting its card, and a rotation's old URL gets `404` at once. Spec 6
section 4 says a rule's card never passes the auto test, and spec 4 gives its card lines, its
receipt and `notice.webhookRotated`. They leave open:

- which mode a rule fills in when its agent goes live or back to paper after its card;
- what becomes of alerts the old URL took that wait in the inbox when the owner rotates the URL,
  deletes the rule or freezes the agent;
- whether a rotation or a delete opens a card;
- what the owner hears of each fill.

The owner rotates a URL because it may have leaked: an alert it took in the last seconds may be a
stranger's. An auto order keeps the mode its agent had when it was made, in `orders.paper`
([decision 0189](0189-an-auto-order-starts-on-its-card-s-tap-and-pauses-while-its-agent-is-frozen.md)),
and pauses while its agent is frozen.

## Decision

- **The mode of its card.** A rule fills in the mode its agent had at `webhookRule/create`, as an
  auto order does: a paper rule stays paper when the agent goes live, and its card says so. A live
  rule is refused while live webhook fills are off (decision 0299); they are off until a later
  release builds them (decision 0338).
- **No card for a rotation or a delete.** Both brake: neither moves funds or widens a bound. A
  rotation needs `admin`, a delete `confirm`, as spec 1 gives them. A rotation makes a new 32-byte
  secret, answers its URL once and sends `notice.webhookRotated` naming the surface. A delete ends
  the rule `deleted`; its URL gets `404` at once.
- **The URL is shown once and kept nowhere.** Only the secret's SHA-256 is stored. The answer of
  `webhookRule/create` and of `webhookRule/rotateUrl` carries the URL once, and the idempotency
  store keeps that answer without it, as `token/create` is not served because its answer would
  keep a secret there ([decision 0154](0154-the-cli-makes-a-client-token-and-the-engine-keeps-only-its-hash.md)).
  A repeat of the same call with the same key gets no URL: it fails `webhook.url_shown`, whose
  words say the URL was shown once and to rotate the rule for a new one. No log line, journal
  entry or backup holds a URL.
- **What the old URL took is dropped.** An alert accepted before a rotation, still waiting, fills
  nothing and is recorded as `url_rotated`. Which alerts those are is read from their rows, not
  their times: the rotation's write keeps the last `webhook_events` row of the rule, and every
  alert at or below it came to the old URL. The listener checks the hash in its own write, so no
  alert of the old URL lands after the rotation's write, even in the same millisecond or after a
  clock set back. An alert of a rule deleted, expired or past its last fill before its fill starts
  is recorded as `order_inactive`. Neither is told: the owner made the change.
- **A rule ends with its last fill or its expiry.** The fill that uses a rule's last fill ends the
  rule `deleted` in its own write, and a rule past its expiry ends `deleted` within a second. An
  ended rule leaves the 20-rule count and `webhookRule/list`, and its URL gets `404`. Neither end
  is told beyond the last fill's own notice: the owner set the bound.
- **A freeze.** A freeze ends a rule awaiting its card as `deleted` (decision 0299). An active
  rule stays active while its agent is frozen, so its URL keeps answering and the sender sees no
  change, and each alert skips as `frozen`, told once in a row. An unfreeze needs no new card.
- **Notices.** Each fill is told with `notice.fill`, and each skip told once per reason in a row
  (decision 0336) with `notice.skipped`, at most five notices an hour per rule, as an alert's and
  a copy order's skips are ([decision 0245](0245-an-alert-fires-once-per-match-tells-the-owner-and-wakes-the-agent-marked.md)).
  The rest are counted, and the first notice of the next hour comes after one line,
  `notice.webhookHeld`, that says how many the hour before held back. Every fill and skip still
  shows in the intent history and on the rule's view. Repeats and alerts over the rate are
  recorded and never told one by one (spec 4, section 4.4).
- **Never in auto mode.** A rule's card always waits for the owner's tap, whatever the agent's
  mode (spec 6). Its fills are authorized by the rule, never by auto mode, and pass the per-trade
  and 24-hour caps.
- **Unmarked.** A rule is made by the owner, and its fills read nothing of an alert's body, so its
  fills carry no outside-content mark.

## Consequences

- Each rule keeps its mode, its wallet, the intent of its card, when its URL last changed and the
  last row its old URL took, in the engine migration that decision 0338 adds; `url_rotated` is a
  new skip reason with `reason.url_rotated`, and `webhook.url_shown` a new error, in English and
  Chinese.
- A client whose answer to `webhookRule/create` was lost cannot read the URL again; the owner
  rotates the rule for a new one.
- A rule that fills 60 times a minute sends five notices, then one line an hour later; the owner
  reads every fill in the history.
- A frozen agent's sender keeps getting `202`, and the owner reads the skips on the rule.

## Alternatives

- **Fill what the old URL took.** It holds inside the bounds, but the owner rotated because the URL
  may be in a stranger's hands.
- **A card for a rotation.** It would delay the brake the owner pulls on a leaked URL.
- **`404` while frozen.** The sender's alert log would fill with errors, and a freeze tells the
  owner already.
- **Fill in the agent's mode now.** A paper rule would trade live funds the owner never confirmed
  for it.
