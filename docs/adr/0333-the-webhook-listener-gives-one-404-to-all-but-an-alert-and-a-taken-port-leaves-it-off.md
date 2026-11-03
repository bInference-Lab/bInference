# 0333. The webhook listener gives one 404 to all but an alert, and a taken port leaves it off

Status: Accepted

Accepted by the owner on 2026-11-03, with the owner's rulings of the same day: the listener takes
any body, JSON or not, and a taken port is told to the owner in a notice. The bounds on
connections, reads and refused rows, the headers and the daily prune were added before the
merge, after the branch's second review, by the lead's rulings of the same day.

## Context

Spec 1, section 2.2 gives the webhook listener one route, `POST /hook/:ruleId/:secret`, a body of
at most 16 KiB, and four answers: `202`, `404` for an unknown rule or a wrong secret alike, `409`
for a repeat within 10 minutes and `429` above the rule's rate. [Decision
0299](0299-a-webhook-rule-fills-once-a-minute-unless-it-names-a-rate-up-to-sixty.md) reads only
the body's `id` and records an alert over the rate as `rate`. Spec 3 keeps each alert in
`webhook_events`, and the listener stores each accepted alert in the inbox before it answers.
Left open: the answer to a body over 16 KiB, what a body that is not JSON does, which earlier
alerts count as repeats and toward the rate, what the listener does with any other request, how
many connections, reads and rows outside requests may drive, and what the engine does when the
listener's port is taken.

The rule's secret is 32 random bytes, so nobody guesses it; what an outsider can learn is whether
a rule id exists, from a different answer or a different time. A funnel's host name is public in
Certificate Transparency logs, so anyone may find the listener. TradingView sends an alert's
message as `application/json` when it is valid JSON and as `text/plain` otherwise; its default
message is plain text, and it does not retry. Tests and the owner's own engine may both run on
one machine, and the default port 7457 is one any program may hold.

## Decision

- **One route, one 404.** Any request that is not `POST /hook/<rule>/<secret>`, read from the
  target as sent with no normalization, with a `whr_` rule id and a secret of 43 base64url
  characters, gets the same empty `404` an unknown rule gets, from its request line alone, before
  any body: the console, `/ws`, `/pair`, `/health`, dot segments, encoded slashes and WebSocket
  upgrades too. The engine's routes are never served there. Those forms are public, so answering
  them early tells nothing.
- **The same work before every 404.** For a well-formed request the listener hashes the secret
  with SHA-256, reads the rule by id, and compares the hash in constant time with the rule's, or
  with a fixed decoy's when no rule has the id. An unknown rule, a wrong secret, a rule that is not
  `active` and a rule past its `expiresAt` all answer `404` after that same read and comparison,
  and record nothing. A found row costs the store a few microseconds more than a missing one,
  which may tell whether an id exists, never anything of a secret.
- **Any body is an alert.** The whole body is read first: over 16 KiB, declared or counted as it
  arrives, is `413`, before any rule is read. A sender that asks first (`Expect: 100-continue`)
  is told to send only for the route with a body in bounds. Any body up to 16 KiB is taken, JSON
  or plain text, and stored with the alert: its text when it is UTF-8, a leading byte order mark
  kept, else its bytes in base64. Its repeat key is its `id` when it is a JSON object whose `id` is
  a string of 1 to 128 characters, and the body itself in every case. Nothing in it sets a fill's
  size or side.
- **What counts.** Only `accepted` alerts count: a repeat is an accepted alert of the same rule
  with the same `id` or the same body received less than 10 minutes before; the rate counts the
  accepted alerts of the 60 seconds before. Repeats and alerts over the rate get a row each,
  judged and written in one store write with the rule's state, so two alerts at once cannot both
  pass. The listener writes no `rejected` row.
- **Bounds on what outside requests drive.** A rule records at most ten times its rate of
  refused alerts in the minute that began with its first; past that, an alert is answered `429`
  from a count in memory with no write until the minute ends, so decision 0299's `rate` row is
  written up to that many a minute, enough to show what happened. The count keeps at most 1,024
  rules and drops the one counted longest ago. Rule reads are held to 50 a second; past that, a
  request is answered the same `404` with no read. The listener holds up to 512 connections,
  each with at most a 16 KiB body, gives a request 5 seconds to arrive whole, checked every
  second, and closes every connection after its answer.
- **Stored before the answer.** An accepted alert's `webhook_events` row, its inbox entry under
  `wh:<event row>` (payload `{ rule, event, alertId?, body }`) and the rule's `last_alert_at` are
  one write; `202` goes only after it. A write that fails or is not confirmed within 10 seconds
  answers `503`; one not confirmed in time may still commit and fill later. A request whose body
  never arrives whole, because its sender left, its time ran out or the engine stopped, ends its
  connection with no answer, and never ends the engine.
- **Plain answers.** No answer has a body, and each carries only `cache-control: no-store`,
  `content-length: 0`, `x-content-type-options: nosniff` and `connection: close`, so the answers
  do not tell a scan which hosts run binference.
- **No lockout.** Wrong secrets are never counted against a sender: no secret can be guessed, and
  a lockout would let a stranger block the owner's own sender.
- **Its own port, or none, and the owner is told.** The listener binds `127.0.0.1` at
  `engine.webhookPort` right after the engine's protocol server, and closes before it in the
  shutdown, letting requests under way finish for 5 seconds. When the port is held by another
  listener (`EADDRINUSE`), the engine's own port among them, the engine runs without the listener,
  logs `webhook.listen_failed`, and sends the owner `notice.webhookPortTaken`, which names the
  port and says to set `engine.webhookPort` to a free one. Any other bind failure, a stopped start
  among them, is logged only. No alert arrives then, so no fill runs.
- **Kept 90 days.** A daily prune, a minute after each start and then every day, deletes the
  `webhook_events` rows received more than 90 days ago and the inbox entries handled more than 30
  days ago; an event row's id is never reused, since its inbox entry outlives it.
- **Tests never take 7457.** An engine a test starts binds the webhook listener at a free port of
  the system's choosing, or the one the test names, never the default.

## Consequences

- A sender learns nothing of a secret from a `404`: the intake's test counts the same store read
  and the same comparison on both paths. The server's time band test shows only that neither path
  does gross work the other skips; it cannot see the decoy's 100 ns.
- TradingView's default plain-text message fills a rule as a JSON one does; the same text within
  10 minutes is a repeat, so a plain-text alert that fires more often needs a varying text.
- A leaked URL fills a rule at most its rate a minute and writes at most ten times that in refused
  rows; the owner's own new alerts are refused with `429` too while the flood lasts, until the
  owner rotates the URL.
- An owner whose port 7457 another program holds still trades; their rules take no alert until
  they set `engine.webhookPort`, and each start says so in a notice.
- `webhook_events` is made again with an id that is never reused, indexed by rule, outcome and
  time and by time alone; `webhook_rules` gains `last_alert_at`, and the inbox an index of its
  handled entries (engine migration 0057).
- `InboxStore.unhandled` pages by source key prefix, so webhook alerts that wait never fill the
  Telegram ingress's page.

## Alternatives

- **Refuse a body that is not JSON with `400`.** It would follow spec 1's first wording, but
  TradingView's default message would never fill a rule.
- **Refuse to start when the port is taken,** as `engine.port` does. The owner would know at once,
  but a program on 7457 would stop the engine, and its money tools with it, for a listener most
  installs never use.
- **Check the rule before reading the body.** A wrong secret would then answer before the body
  arrives, at a different time from a body over 16 KiB; reading first keeps one order for all.
- **Count every alert toward the rate.** A leaked URL's repeats would then hold the rule at its
  rate and refuse the owner's own new alerts.
- **One row per refusal, without a bound.** Every request of a leaked URL would take the writer
  the wallet queue and the ledger use, and grow the table until the disk fills.
