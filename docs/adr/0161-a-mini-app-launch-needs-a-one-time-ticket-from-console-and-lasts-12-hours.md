# 0161. A Mini App launch needs a one-time ticket from /console and lasts 12 hours

Status: Proposed

Amends [decision 0160](0160-a-mini-app-launch-signs-in-once-and-a-new-owner-ends-the-old-one-s-mini-app.md).

## Context

[Decision 0160](0160-a-mini-app-launch-signs-in-once-and-a-new-owner-ends-the-old-one-s-mini-app.md)
signs a Mini App in with the `initData` Telegram signed for the launch. Telegram signs `initData`
with the bot token for every Mini App the bot opens: the menu button, the main Mini App, a
`web_app` button another program using the same bot sends, a direct `t.me` link. Any page one of
those opens receives the owner's fresh `initData`, and within 5 minutes it can open a WebSocket to
the engine's public address and sign in with `confirm` and `loosen`. The signature proves that the
owner opened a Mini App of the bot, not that the owner opened ours.

A Mini App connection also has no end of its own. A Mini App left open in Telegram keeps
`confirm` and `loosen` for as long as its socket lives, which can be days. A console device's
connection has no lifetime either, but a device is a key the owner paired on purpose and can
revoke; a Mini App sign-in is a launch.

## Decision

- **`/console` makes a launch ticket.** Each `/console` makes 32 random bytes in base64url. The
  engine keeps only the SHA-256 of `mini-app-ticket:` and the ticket, in `engine.sqlite`
  (`mini_app_tickets`), with the Telegram id of the owner who asked and an expiry 5 minutes later.
  A new ticket deletes the expired ones and keeps at most the newest 16.
- **The ticket rides in the button's fragment.** The `web_app` button opens
  `<remote.publicUrl>/mini#ticket=<ticket>`. A fragment never reaches the engine, the tunnel or a
  log, and Telegram adds its own launch fields to the same fragment.
- **A Mini App sign-in needs a live ticket and spends it.** The Mini App sends
  `open.auth.telegram.ticket`. The engine checks it in the same transaction that claims the launch
  (decision 0160): the ticket must exist, belong to the launch's Telegram user and not have
  expired; then it is deleted and the launch is kept. A missing, unknown or other user's ticket
  ends the connection with `bye auth.invalid`, an expired one with `bye auth.expired`. A launch
  refused for its ticket is not claimed.
- **A Mini App connection lasts 12 hours.** It ends with `bye auth.expired` 12 hours after it
  signed in, and the console asks the owner to open it again from `/console`. A console device's
  and a client token's connections keep their own rules.

Decision 0160 stays as written for everything else: the 5 minutes both ways, the codes, the 24
hours of seen launches, the `tg:` credential and its scopes, and a new owner ending the old one's
Mini App.

## Consequences

- Only a launch from our `/console` button signs in. A launch from the menu button, a link or
  another program's button gets the owner's `initData` but no ticket, and is refused.
- A ticket works once and for 5 minutes, so the owner sends `/console` again to reopen the Mini
  App, as decision 0160 already asks after a dropped connection.
- `engine.sqlite` gains one small table, at most 16 rows; a sign-in still makes one write.
- A Mini App that stays open past 12 hours signs out, and its owner reopens it from `/console`.

## Alternatives

- **Keep tickets in the engine's memory.** No table, but a restart between `/console` and the
  launch refuses a fresh button. Rejected: the launch claim already writes to `engine.sqlite`,
  and the ticket is spent in that same write.
- **Put the ticket in the query string.** It works with every Telegram client, but the address
  with its query reaches the engine and the tunnel, and can land in their logs. Rejected.
- **No lifetime for Mini App connections**, as for a console device. Rejected: a launch is not a
  key the owner paired on purpose.
- **A shorter lifetime, such as 1 hour.** The owner would reopen the Mini App during a session of
  use. 12 hours covers a day of use and ends a Mini App left open overnight.
