# 0117. A signer or custody failure at start runs the engine locked

Status: Amended by 0119

## Context

[Decision 0103](../DECISIONS.md#d0103) runs the engine locked when the unlock mode cannot open the
agent key or the Privy app secret. Once both open, the engine still starts the signer process with
the key and builds the `privy-owner` custody adapter with the app secret
([spec 5, section 5](../specs/keys-and-backups.md#section-5)). Either can fail: the signer's
program does not start or refuses its settings, it holds another key than the one the wallets name
as their signer, Privy refuses the app id and secret, or Privy does not answer. Decision 0103 did
not say whether such a failure stops the start, and a signer can also stop after the start.

## Decision

- A failure after the keys open never stops `binference start`. The engine runs locked with one of
  three more reasons: `app_secret_rejected` when Privy refuses the app id and secret,
  `custody_unreachable` when Privy does not answer, and `signer_failed` when the signer does not
  start, stops before it answers, or answers another public half than the wallets' signer.
- In that step, Privy checks the app with one read, as `binference init` does; then the signer
  starts and must answer the agent key's public half. Custody opens only once both pass.
- `binference unlock` (`engine/unlock`) runs the whole step again: it reads the keys, checks the
  app with Privy and starts the signer.
- A signer that stops while the engine runs locks the engine again, and every surface gets
  `notice.signerStopped`. `binference unlock` starts it again. Work that needed a signature fails
  closed: custody refuses it, and its intent ends as never signed
  ([decision 0109](../DECISIONS.md#d0109)).

Accepted by the owner on 2026-10-09.

## Consequences

- The lock reasons and the CLI's lock messages gain the three reasons, in English and Chinese.
  Spec 4 gains `notice.signerStopped`, and spec 5, section 3 lists the reasons.
- The engine reaches Privy at each start and unlock. An engine that starts before the network is
  up stays locked until the owner runs `binference unlock`.
- The `custody` health signal is ok while custody is open, and failing while the engine is locked.

## Alternatives

- **Refuse to start.** A service manager would restart the engine in a loop, and reads, paper
  trading and the notices would stop, as decision 0103 weighed. Rejected by the owner.
- **Retry the Privy check and the signer on a timer.** A wrong app secret would hide behind the
  retries, and a signer that crashes at once would restart forever. Rejected: the owner fixes the
  cause, then `binference unlock` retries.
- **Check Privy and start the signer at the first signature.** The owner would learn of a refused
  app secret only when a trade fails. Rejected.
