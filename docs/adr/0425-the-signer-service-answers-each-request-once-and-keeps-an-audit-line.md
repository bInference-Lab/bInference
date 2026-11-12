# 0425. The signer service answers each request once and keeps an audit line

Status: Accepted

Accepted by the owner on 2026-11-12.

## Context

A worker's call to the signer service crosses a network, so its answer can be lost after the
service signed. The engine's `Signer` port knows two refusals, `unknown_wallet` and `refused`,
and its faults (chain package); a lost signing answer is `custody.sign_unknown`, after which the
engine decides (custody-privy rules). Nothing may be signed after the authorization of its intent
ended, but a cancel within decision 0116's minute. Each signature needs a record no worker can
change.

## Decision

- **Outcomes.** The service answers every request with one of: `signed`, `refused` (with its
  reason), `over_sums`, `locked`, `lease_lost` or `down`. The Cloud client maps them onto the
  `Signer` port: `signed` is the signed transaction; `refused` is `refused`, but `unknown_wallet`
  is that refusal; `over_sums` and `locked` are two new refusals of the port; `lease_lost` throws
  `store.lease_lost`, so the worker stops the install; `down`, or no answer, throws
  `custody.signer_down`.
- **Once per request.** Each request carries an id the worker picks. The service keeps every answer
  for 24 hours under the worker's id and the request id, and answers a repeat with the first
  answer; a repeat with another body is refused as `malformed`.
- **Retries.** The client repeats a request only after `down` or no answer, with the same id, and
  only while the intent's authorization still allows a signature; it never repeats any other
  outcome, and never past the authorization's end.
- **Audit.** Each request leaves one line in `signer.audit`, which the service may insert into and
  never change: the time on the database's clock, the request id, the worker id and fence, the
  install, agent, intent, step and wallet, the chain, nonce and replacement, the authorization's
  kind and id, the outcome with its reason or rule, the sums before and after, the signed
  transaction's hash, Privy's request id and how long each part took. No key, signature, app
  secret, raw transaction or calldata goes in it; calldata goes in as its SHA-256.

## Consequences

- A lost answer costs a repeat, never a second signature.
- The engine tells `locked` and `over_sums` apart from a rule's refusal, so the user reads why.
- The audit is the record a reviewer reads to see what was signed and for whom.

## Alternatives

- Map every refusal to the port's `refused`: the user would read one reason for a braked Cloud, a
  full day and a broken rule.
- Let the client retry any refusal: a refusal is a decision, and a retry only adds load.
- Write the audit to the log stream alone: a log line can be lost or edited downstream; the table
  sits in the same transaction as the reservation.
