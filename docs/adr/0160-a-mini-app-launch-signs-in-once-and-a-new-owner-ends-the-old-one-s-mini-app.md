# 0160. A Mini App launch signs in once, and a new owner ends the old one's Mini App

Status: Proposed

## Context

[Spec 1, section 4.2](../specs/protocol.md#section-4-2) says how the engine checks a Telegram Mini
App's `open`: Telegram's signature over `initData` with the owner's bot token, an `auth_date`
within 5 minutes, the owner's numeric user id, and no hash seen in the last 24 hours. It leaves
open whether a launch dated a little ahead of the engine's clock passes, which `auth.*` code each
refusal gets, where the seen hashes are kept, which credential a Mini App connection carries, and
what happens to an open Mini App when a start code pairs another owner
([decision 0139](../DECISIONS.md#d0139)).

## Decision

- **The 5 minutes count both ways.** A launch passes when its `auth_date` lies at most 5 minutes
  before or after the engine's time, so an engine whose clock runs behind Telegram's still signs the
  owner in. A launch dated ahead can be neither forged nor used twice.
- **Codes.** A launch outside the 5 minutes ends with `bye auth.expired`, and the console asks the
  owner to open it again from `/console`. Any other refusal ends with `bye auth.invalid`: a
  signature the bot token did not make, a field missing or sent twice, another Telegram user, a
  launch that signed in before, an engine with no bot or no paired owner, and a launch over IPC.
- **Seen launches stay in the engine's memory**, at most 1,024 for 24 hours, the oldest dropped
  first. Only a launch that passed every other check is kept, so filling the store takes that many
  fresh launches by the owner.
- **A Mini App connection's credential is `tg:<owner id>`**, as the owner's chat names the owner,
  with the scopes `read`, `chat`, `confirm` and `loosen`. It acts as the owner on Telegram, so the
  Mini App opens a rescue or an unfreeze card ([decision 0128](../DECISIONS.md#d0128)).
- **A new owner ends the old one's Mini App.** When a start code pairs a user in an earlier owner's
  place, every connection signed in with the earlier owner's `tg:` credential ends with
  `bye auth.revoked`, as a revoked device's do.

## Consequences

- A launch signs in one connection. A Mini App whose connection drops cannot reconnect with the
  same launch; the console asks the owner to open it again from `/console`.
- An engine that restarts forgets the launches it saw. A launch someone copied could sign in again
  only within its 5 minutes, and only when the engine restarted after the owner used it.
- The 1,024 bound keeps the store's memory fixed whatever the owner does.

## Alternatives

- **Refuse any `auth_date` after the engine's time.** An engine whose clock lags Telegram's by a
  second would refuse a fresh launch. Rejected.
- **Keep seen launches in `engine.sqlite`.** It closes the restart gap, at the cost of a table and a
  migration for a window of 5 minutes. Left for the owner to choose.
- **Let a dropped Mini App reconnect with its launch.** The replay check exists to refuse exactly
  that. A launch could instead buy a short-lived ticket for reconnects; that is a new credential
  the spec does not have. Rejected for now.
