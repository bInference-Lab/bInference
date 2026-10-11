# 0155. binference console pairs a browser through device/pair and POST /pair

Status: Proposed

## Context

The console signs in with a paired device key
([protocol spec, section 4.2](../specs/protocol.md#section-4-2)): `binference console` prints
`http://127.0.0.1:7456/#pair=<code>`, single use and valid 10 minutes, and the browser sends
`POST /pair` with `{ code, publicKey, alg, label }`. The engine owns `engine.sqlite`, where the
pairing codes live beside the Telegram start codes, and no operation hands the CLI a code. The
spec names neither the answers of `POST /pair` when it refuses, nor what happens to a device's
open connections when `device/revoke` revokes it.

## Decision

- **`device/pair`** is a new operation, `admin`, IPC only, served as a read as `telegram/pair` is:
  `{}` → `{ link, expiresAt }`. The engine draws 16 random bytes for the code and stores only the
  SHA-256 of `console-pair:<code>`, so a console code never pairs a Telegram owner and a start
  code never pairs a device. The link names `127.0.0.1` and the port the HTTP listener bound.
  As a read, no idempotency entry holds the code.
- **`POST /pair`** checks the `Origin` as `/ws` does (403 `auth.origin`), takes a JSON body of at
  most 4 KiB, and checks that `publicKey` is an SPKI key of `alg` (`ed25519` or `p256`) and
  `label` 1 to 64 characters (400 `protocol.bad_args`) before it uses the code, so a malformed
  request leaves the code working. An unknown or used code is 401 `auth.invalid`, an expired one
  401 `auth.expired`. A pairing answers 201 `{ deviceId }`. A refusal's body is
  `{ error: { code, message } }`, and the page maps `code` to its message.
- **Every pairing raises `notice.newDevice`** with the label, on every surface (spec 4, section
  4).
- **`device/revoke` ends the device's open connections** with `bye auth.revoked`, so a revoked
  browser loses `confirm` at once, not at its next sign-in.

## Consequences

- The CLI shows the link once and never stores it; the engine keeps only the code's hash.
- A link opened twice pairs once: the second browser is told the link was used and to run
  `binference console` again.
- Whoever holds the link can pair a device until it is used or expires, as with a start code; the
  owner hears of every pairing in Telegram and in the console.

## Alternatives

- **The CLI writes the code into the database itself.** The engine is the one writer of
  `engine.sqlite`, and the CLI reaches it only over IPC. Rejected.
- **`device/pair` as a write.** Its result would keep the code in the idempotency store for 24
  hours. Rejected, as for `token/create` ([decision 0154](../DECISIONS.md#d0154)).
- **One answer, 401 `auth.invalid`, for every refused code.** The page could not tell an expired
  link from a mistyped one; the code is 128 random bits, so telling them apart helps no guesser.
- **Leave a revoked device's connections open until they close.** A lost laptop's open tab would
  keep the `confirm` scope.
