# 0104. binference unlock sends the passphrase over IPC

Status: Accepted

## Context

In the `manual` unlock mode the agent key sits in a file sealed with the owner's passphrase, opened
"by `binference unlock` over IPC after each start"
([spec 5, section 3](../specs/keys-and-backups.md#section-3)). The protocol had no operation for
it, and `engine/status` could not say that the engine is locked
([decision 0103](../DECISIONS.md#d0103)). Inside a protocol version, new operations, new optional
fields and new enum values are additions ([spec 1, section 9](../specs/protocol.md#section-9)). The
idempotency store keeps a hash of each write's args for 24 hours, and an unsalted hash of a
passphrase can be guessed offline.

## Decision

- A new operation `engine/unlock`: scope `admin`, a write, IPC only. Its args are
  `{ passphrase?: string }`: the passphrase in the `manual` mode; any other mode takes none and
  reads its source again, such as a keychain that was locked at start. It answers `{}`, and `{}`
  again once the engine is unlocked, whatever the args. When the keys still do not open, it fails
  with `engine.locked` and `details.reason`, one of the reasons of decision 0103.
- The passphrase is never logged, and the hash the idempotency store keeps leaves it out.
- The engine state gains `locked`, in `ready`, `engine/status` and `GET /health` (200). A locked
  engine serves every call; a push on topic `engine` announces the unlock.
- `binference unlock` calls `engine/unlock` with no passphrase first. When the engine asks for one,
  it asks the person at the terminal with hidden input, up to 3 tries. No flag takes a passphrase.

## Consequences

- The protocol stays at version 1: a new operation and a new engine state are additions.
- A successful unlock hands the keys to the step that starts the signer and custody; until that
  step exists, an unlock only changes the engine state.
- `binference unlock` needs a terminal in the `manual` mode; scripts can unlock every other mode.
- `binference status` shows the locked state in English and Chinese, and so must Telegram's
  `/status` reply when it comes (spec 4, section 5).

## Alternatives

- **The CLI opens the sealed file and sends the agent key.** The key would leave the keys folder
  through a second process and cross the socket. Rejected.
- **A socket of the signer's own.** The signer opens no socket (spec 5, section 5). Rejected.
- **A prompt on the engine's own terminal.** A service has none. Rejected.
- **The passphrase as a flag or an environment variable.** It would land in the shell history or
  the process list. Rejected.
