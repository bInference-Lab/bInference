# 0333. The webhook listener gives one 404 to all but an alert, and a taken port leaves it off

Status: Accepted

Accepted by the owner on 2026-11-03, with the owner's rulings of the same day: the listener takes
any body, JSON or not, and a taken port is told to the owner in a notice.

## Context

Spec 1, section 2.2 gives the webhook listener one route, `POST /hook/:ruleId/:secret`, a body of
at most 16 KiB, and four answers: `202`, `404` for an unknown rule or a wrong secret alike, `409`
for a repeat within 10 minutes and `429` above the rule's rate. [Decision
0299](0299-a-webhook-rule-fills-once-a-minute-unless-it-names-a-rate-up-to-sixty.md) reads only
the body's `id`. Spec 3 keeps each alert in `webhook_events`, and the listener stores each
accepted alert in the inbox before it answers. Left open: the answer to a body over 16 KiB, what
a body that is not JSON does, which earlier alerts count as repeats and toward the rate, what the
listener does with any other request, and what the engine does when the listener's port is taken.

The rule's secret is 32 random bytes, so nobody guesses it; what an outsider can learn is whether
a rule id exists, from a different answer or a different time. TradingView sends an alert's
message as `application/json` when it is valid JSON and as `text/plain` otherwise; its default
message is plain text. Tests and the owner's own engine may both run on one machine, and the
default port 7457 is one any program may hold.

## Decision

- **One route, one 404.** Any request that is not `POST /hook/<rule>/<secret>`, read from the
  target as sent with no normalization, gets the same empty `404` an unknown rule gets: the
  console, `/ws`, `/pair`, `/health`, dot segments, encoded slashes and WebSocket upgrades too.
  The engine's routes are never served there.
- **The same work before every 404.** For a well-formed rule id the listener hashes the secret
  with SHA-256, reads the rule by id, and compares the hash in constant time with the rule's, or
  with a fixed decoy's when no rule has the id. An unknown rule, a wrong secret, a rule that is not
  `active` and a rule past its `expiresAt` all answer `404` after that same read and comparison,
  and record nothing.
- **Any body is an alert.** The whole body is read first: over 16 KiB is `413`, before any rule
  is read, and the connection closes. Any body up to 16 KiB is taken, JSON or plain text, and
  stored with the alert: its text when it is UTF-8, else its bytes in base64. Its repeat key is
  its `id` when it is a JSON object whose `id` is a string of 1 to 128 characters, and the body
  itself in every case. Nothing in it sets a fill's size or side.
- **What counts.** Only `accepted` alerts count: a repeat is an accepted alert of the same rule
  with the same `id` or the same body received less than 10 minutes before; the rate counts the
  accepted alerts of the 60 seconds before. Repeats and alerts over the rate get a row each,
  judged and written in one store write with the rule's state, so two alerts at once cannot both
  pass. The listener writes no `rejected` row.
- **Stored before the answer.** An accepted alert's `webhook_events` row, its inbox entry under
  `wh:<event row>` (payload `{ rule, event, alertId?, body }`) and the rule's `last_alert_at` are
  one write; `202` goes only after it. A write that fails or takes over 10 seconds answers `503`.
- **No lockout.** Wrong secrets are never counted or throttled: no secret can be guessed, and a
  lockout would let a stranger block the owner's own sender.
- **Its own port, or none, and the owner is told.** The listener binds `127.0.0.1` at
  `engine.webhookPort` right after the engine's protocol server, and closes before it in the
  shutdown, letting requests under way finish for 5 seconds. When the port is taken, by another
  program or by `engine.port` itself, the engine runs without the listener, logs
  `webhook.listen_failed`, and sends the owner `notice.webhookPortTaken`, which names the port and
  says to set `engine.webhookPort` to a free one. No alert arrives then, so no fill runs.
- **Tests never take 7457.** An engine a test starts binds the webhook listener at a free port of
  the system's choosing, or the one the test names, never the default.

## Consequences

- A sender learns nothing of a rule from a wrong secret but the `404` every stranger gets; the
  server test holds the two answers byte for byte and their median times within a band.
- TradingView's default plain-text message fills a rule as a JSON one does; the same text within
  10 minutes is a repeat, so a plain-text alert that fires more often needs a varying text.
- An owner whose port 7457 another program holds still trades; their rules take no alert until
  they set `engine.webhookPort`, and each start says so in a notice.
- `webhook_events` gains an index by rule, outcome and time, and `webhook_rules` gains
  `last_alert_at` (engine migration 0057).
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
