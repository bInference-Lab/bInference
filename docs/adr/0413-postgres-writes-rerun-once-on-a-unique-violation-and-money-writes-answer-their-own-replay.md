# 0413. Postgres writes rerun once on a unique violation and money writes answer their own replay

Status: Accepted

Accepted by the tech lead on 2026-11-12. Amends
[decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md).

## Context

[Decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md)
runs a Postgres write again from its first read on SQLSTATE `40001` or `40P01`, at most three times
more, and maps every other error the server sends by its class: `23xxx` is `store.constraint`. A
connection lost while `COMMIT` is in flight fails `store.commit_unknown`, and the caller rereads
before it decides again.

Two writers that insert one key at once do not always meet as a `40001`. Postgres reports a
serialization failure for a duplicate only when the inserting transaction read the key's range
and another transaction wrote into it since; without that read the second insert fails `23505`
(`23P01` for an exclusion constraint). The Postgres manual (section 13.6, "Serialization Failure
Handling") advises retrying both, since the client cannot tell them from a serialization failure.
The second review of the money stores found tasks that insert a key their caller chose without
reading it: an intent's launch draft reference and an agent's identity were safe only because an
earlier statement in the same task updated a counter row both writers touch. A loser of such a race
gets `store.constraint`, where the port promises a domain answer (`exists`, `stale`, `counted`,
`nonce_taken`). Nothing doubles, since the unique index holds, but a surface shows an error in
place of the answer, such as the launch a first Start began.

No code handles `store.commit_unknown` yet; the Cloud worker will. A blind replay of a write that
did commit answers today as if another writer had won: `saveSigned` answers `nonce_taken` for its
own stored step, `ledger.append` throws `store.constraint` on its own id, `positions.record`
answers `stale` and `recordLandedFill` answers `counted`. A caller that reads `nonce_taken` as a
lost nonce would end an intent whose signed step is stored.

## Decision

- **A unique violation reruns once.** `postgresWrite` counts `23505` and `23P01` as a conflict for
  one rerun from the first read, inside 0366's budget of three retries and after the same waits,
  logged as `store.write_retried` with its SQLSTATE. A write that meets one again, or meets one
  with no retry left, fails `store.constraint`.
- **A task reads the key it inserts.** Every store task that inserts a key its caller chose (an
  id, a reference, one row per agent or intent) reads that key in the same task first, or the row
  whose version owns it, so the rerun finds the row and answers the port's domain answer. In the
  money stores:
  - `intents.create` reads the id and the launch draft reference: either in use is `exists`.
  - A move that carries an identity reads the agent's: an agent that holds one makes the move
    `stale`, as a fill's order the move may not take does. The executor reads the intent again,
    and when no other write moved it, tells the owner of the duplicate (`notice.identityDuplicate`)
    and reconciles it with no identity, as it did on the thrown fault.
  - `ledger.append` and every intent write's entry read the entry id; `saveSigned` reads the
    transaction id; `orders.create` reads the order id and its card intent; `unbondings.open` reads
    its intent and its venue's request. A key in use with other content stays `store.constraint`.
  - The rows that already read their keys keep doing so: fill rows, late landings, positions by
    version, the account's nonces, confirmations by intent, departures by intent. A card version
    belongs to its intent's version, which the move reads first. Write-order keys come from the
    counters, which serialize every writer.
- **A money write answers its own replay as its first run did.** On `store.commit_unknown` a money
  caller replays the same write, so:
  - `saveSigned` of a step stored at its account's nonce with the same intent, step and bytes is
    `ok` with the stored transaction and its id; other bytes at that nonce stay `nonce_taken`.
  - `ledger.append` of an entry stored with the same id and content answers the stored entry.
  - `positions.record` of an execution its intent already stored with the same content, while each
    position it wrote still holds what it set, answers the stored execution, its number included.
    Once another write moved one of those positions the write is judged anew and answers `stale`,
    so two writes of one trade from different reads never both read as landed.
  - `recordLandedFill` whose fill row is the one that counts its intent answers `ok` with the
    orders its moves name, as they stand.
  - `intents.create` and `transition` keep `exists` and `stale` on a replay: their callers read the
    intent again, which tells whether the write landed.
- **The wallet queue never signs twice for one step.** A `nonce_taken` from `saveSigned` ends the
  intent before any send (decision 0109); the queue takes no other nonce for it. With the replay
  rule a step that was stored answers `ok`, so the run sends the stored bytes.
- **The caller lands with the Cloud worker.** The worker that holds an install's agents catches
  `store.commit_unknown` and replays the same write once its connection is back. SQLite never
  fails a commit unknown, so self-hosted is unchanged.

## Consequences

- A loser of a same-key race gets the port's answer on both databases; contract races pin two
  creates of one intent id, two creates of one launch draft reference and two registrations of one
  agent's identity.
- A real duplicate costs one rerun before it fails `store.constraint`.
- The tasks above read one more indexed row each.
- A contract case per money write runs it twice and gets the same answer with no second row.
- The engine's identity path reads a stale move again instead of catching a thrown fault, so a
  trigger's refusal, which is `store.constraint` on both databases, never reads as a duplicate.
- Outside the money stores, the server's idempotent writes dedupe a running key in one process's
  memory only; two replicas taking one key both run the write. The Cloud ingress must claim the key
  before the work, which is the ingress task's.

## Alternatives

- **Map `23505` to `store.write_conflict`.** A real duplicate would read as a passing conflict and
  be retried by callers forever.
- **Rerun `23505` without the reads.** A task that never reads its key meets the same row on the
  rerun and fails `store.constraint` again; the rerun helps only a task that reads first.
- **Reads alone, no rerun.** A missed read, or one on another index than the insert's, still
  surfaces `23505`; the rerun covers it at the cost of one attempt.
- **Callers that reread by id after `store.commit_unknown`.** Each money caller would need its own
  read path and its own rule for what landed; one rule in the stores serves every caller.
