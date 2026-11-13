# 0439. The engine follows the breaker through a profile part it reads every second

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

bInference Cloud's breaker is one row, `cloud.breaker`, which only bInference's owner moves
([decision 0424](0424-the-cloud-breaker-is-one-row-only-binference-s-owner-moves-read-on-every-signature.md)).
The signer service reads it in each request's check transaction and, while it is pulled, signs
nothing but a rescue's steps. The workers must also freeze every agent they hold, with a freeze's
rules ([spec 5, section 8.6](../specs/keys-and-backups.md#section-8-6)). The row, the operations
control and the worker's loop that reads the row live outside this repository; the engine each
worker composes has no way to learn of a pull today.

The engine reads other facts that depend on the profile through ports the composition root fills,
such as `QuotaSource` ([decision 0431](0431-quotas-come-from-one-port-and-are-counted-from-the-install-s-stores.md)).
Self-hosted has no breaker. One worker holds many installs, each served by an engine of its own,
and each must take a pull within seconds. The engine's timed work already runs on timers of the
composition root, such as the copy orders and the webhook fills every second.

## Decision

- **The port.** `BreakerSource` of `@binference/engine`, a profile part: `read(call)` answers
  `BreakerState`, `{ pulled, version, changedAtMs? }`. `version` is a whole number that rises with
  every move of the row and never goes down. A read that cannot answer rejects with a fault, and
  with the signal's reason once the signal aborts. An adapter that answers from a copy of the row
  rejects once its copy is older than 10 seconds.
- **The adapters.** Self-hosted's `noBreaker` answers `{ pulled: false, version: 0 }` to every
  read. The Cloud adapter answers from the worker's own reading of the row and lives outside this
  repository. `@binference/engine/testing` holds an in-memory fake a test pulls, lifts and makes
  fail, and the contract suite every adapter passes. `ProfileParts.breaker` is required, so no
  composition root leaves it out.
- **One engine work follows it.** `Engine.followBreaker({ signal })` reads the source and, when
  the version it answers is above the one the install applied last
  ([decision 0440](0440-the-breaker-holds-an-install-by-a-mark-of-its-own-apart-from-the-owner-s-freeze.md)),
  writes the breaker's freeze or its lift. A read at or below the applied version writes nothing,
  so a copy that lags never undoes a newer state.
- **Each read has a deadline.** A read races 2 seconds of the engine's clock, whatever the adapter
  does with the signal: one that has not settled by then answers `unread` with
  `breaker.timeout`, its signal aborts, and the look keeps the stored state, at the start and on
  every tick. A read that never settles so never holds the start or stops the timer.
- **One look at a time.** Within one engine a look runs alone: a call made while one runs waits
  for it, then reads the source again. The engine remembers the version its last look left
  applied and told, so a tick whose source answers that version reads no install; a look that
  fails forgets it.
- **Who calls it.** The startup calls it once, after the stores open and before the keys, the
  recovery, the repairs and the confirmed intents a stop left, so none of those goes on while the
  breaker holds. A timer of the composition root calls it every second, locked or not: it signs
  nothing. A Cloud worker may also call it at once for each install it holds when its reading of
  the row sees a new version; the call is the same, and the next tick catches one that was missed.
- **A source that cannot be read keeps the last answer.** A read that rejects writes nothing: the
  install stays as the last version it applied left it, held or not. The engine logs
  `engine.breaker_unread` once when the reads begin to fail and `engine.breaker_read` once they
  answer again. It never pulls and never lifts on a failed read, at the start either: the start
  goes on with the stored state, and the timer asks again each second. A failed read never fails
  the start or stops the engine.
- **Self-hosted** composes `noBreaker`. Its stored version stays 0, so `followBreaker` reads the
  same answer each second and never writes.

## Consequences

- A pull takes hold of every install a worker holds within a second of the worker's reading, or at
  once when the worker calls, and no install's engine reads the shared schema itself. A tick that
  finds nothing new costs a read of the source's copy in memory and no store read.
- A source that hangs costs each look 2 seconds and nothing more: the next look reads again.
- Between the pull's commit and the engine's write, a card may open or a tap land. The signer
  service refuses that step `locked` with `breaker`, which ends it as never signed
  ([decision 0427](0427-the-engine-ends-an-intent-the-signer-service-answers-over-sums-or-locked.md)),
  and the engine's write cancels what is left unsigned.
- While the source cannot be read, a pull does not reach the engine; the signer service answers
  `down` while it cannot read the row, so no signature passes either way. On Cloud the row lives in
  the same database as the install's rows, so an outage of that database stops the engine's writes
  as well.
- ARCHITECTURE.md lists `BreakerSource` among the profile ports in section 30, and section 24's
  startup order names the breaker's step.
- The Cloud worker's entry composes the adapter, starts the timer and may call `followBreaker` on
  a change; that part lives with the worker.

## Alternatives

- **Each engine reads the row itself every second.** A worker that holds 1,000 installs would read
  one row 1,000 times a second, and the engine would need a grant on the shared schema. The port
  leaves the reading to the worker, once for all its installs.
- **Only a call the worker makes on a change.** A missed call is never caught, and a start needs a
  read anyway.
- **A slower timer, such as every 10 seconds.** The read answers from memory, so a second costs
  nothing, and cards close at once for every user.
- **Fail closed: a failed read counts as pulled.** A pull cancels every card that waits and pauses
  every auto order of every install, which no lift brings back. A short outage of the worker's
  reading would do that to every user, while the signer service already refuses each signature it
  cannot check.
- **No stored state: each check reads the source.** Weighed in decision 0440.
