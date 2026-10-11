# 0158. A card reaches a closed console through browser push

Status: Accepted

Accepted by the owner on 2026-10-11.

## Context

A card waits 60 seconds. Telegram shows it, and the console shows it while its tab is open. When
the owner has Telegram closed and the console tab in the background or shut, a card expires
unseen. Browsers wake a site's service worker through their vendor's push service: Web Push
(RFC 8030), with the message encrypted to the browser (RFC 8291) and the sender identified by a
VAPID key pair (RFC 8292). The engine binds to `127.0.0.1` only, so the push service never calls
the engine: the engine sends one outbound HTTPS request per browser, and the woken console talks
to the local engine as it always does.

The protocol spec has no operation that binds a browser's subscription to a device, and the
database spec has no table for one.

## Decision

- **The VAPID key pair** is a P-256 key made by `binference init`, and at start when the state
  folder lacks it (an install from before, or a new machine, whose copy leaves `keys/` behind). Its
  private half lives in `keys/web-push-vapid`, owner-only, as PKCS #8 in base64url; never in
  `config.json5` or a database. The JWT's `sub` is `https://binference.io`, as Apple's push
  service refuses a token without one; it names no person.
- **Three operations** (protocol spec, section 7.9): `webPush/status` (`read`) answers the public
  key and whether the calling device holds a subscription; `webPush/register` and
  `webPush/unregister` (`confirm`, writes) add and drop the calling device's subscription. Both
  are device only: any caller but a paired console device fails with the new code
  `auth.device_only`, whatever its scopes, as a subscription is bound to the device that sent it.
  An endpoint must be HTTPS on a named host, never an IP address or `localhost`.
- **`engine.sqlite` keeps the subscriptions** (`web_push_subscriptions`): the endpoint, the
  browser's two keys, the device and the VAPID public key it was made for. `device/revoke` drops
  the device's subscriptions in its own transaction. A subscription made for another VAPID key is
  dropped when the engine next sends.
- **What is sent**: when a card version opens, and when it closes by an answer or its timer, each
  subscription gets one message: `{ v: 1, kind, intent, card, title, body }`, the words in the
  owner's language (spec 4, section 4.1), with no amount, address, token or agent name. It is
  encrypted with `aes128gcm` and sent through the `Http` port with `TTL` (the card's time left, or
  10 minutes for a close), `Urgency` (`high` for an open, `normal` for a close) and a `Topic` from
  the intent's id, so a close replaces an open the push service still holds. A 404 or 410 drops
  the subscription; any other refusal is logged and dropped from the line.
- **The crypto is our own code** on `node:crypto` (ECDH, HKDF, AES-128-GCM, ES256), checked
  against the worked example of RFC 8291, appendix A.
- **The console** asks for the notification permission only when the owner turns notifications on
  in it. Its service worker shows the message, gives it the intent's id as its tag, and on a click
  opens or focuses the console at the card. Confirming still needs the device's signed
  connection. The Mini App does not subscribe: Telegram notifies there.

## Consequences

- The owner can answer a card from a browser notification with Telegram closed.
- The browser vendor's push service learns when a card opens and closes, and the device's
  endpoint; it cannot read the message.
- The engine makes outbound HTTPS requests to push services. A device that pairs again, or a new
  machine's key, means the console subscribes again; it does so when it next opens.
- `engine.sqlite` holds each browser's authentication secret, which every message is encrypted
  with, so it cannot be a hash. A copy of the database alone sends nothing: the push service takes
  a message for the subscription only with the VAPID key's signature, and that key stays in
  `keys/`. A stolen VAPID private key lets its holder send notifications to the owner's browsers
  until the engine makes a new one.

## Alternatives

- **The `web-push` npm package.** Its last release is from January 2024, it brings a command-line
  argument parser and a proxy agent the engine does not use, and it sends through its own HTTPS
  client instead of the `Http` port. The three primitives it wraps are in `node:crypto`. Rejected.
- **Keeping the VAPID key in `engine.sqlite`.** Backups and copies of the database would carry a
  private key. Rejected.
- **Notifications from the open tab only** (the Notification API without a push service). Nothing
  reaches a closed tab. Rejected.
- **Putting the amount or the agent in the message.** Faster to read, but the push service's
  operator would hold the owner's trades in its logs. Rejected.
- **Any client with `confirm` registers a subscription.** The CLI and the Mini App have no browser
  to wake, and a subscription without a device could not be dropped when a device is revoked.
  Rejected.
