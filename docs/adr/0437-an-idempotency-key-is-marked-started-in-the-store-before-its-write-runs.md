# 0437. An idempotency key is marked started in the store before its write runs

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

Every write takes a key, and the engine keeps `(credential, op, key)` with the hash of its args
and its result for 24 hours: the same key with the same args answers the stored result, other args
fail `protocol.key_reused`, and a write is stored durably before its reply
([spec 1, section 5](../specs/protocol.md#section-5)). The protocol server does this in three
steps (`packages/server/src/idempotent-writes.ts`): it reads the key (`recall`), runs the write,
then stores the result in a write of its own (`remember`). A call with a key whose write still runs
waits for it through a map in the server's memory. A refused or failed write stores nothing, so
its key may run again.

The map lives in one engine start. The client sends every call still waiting again on its next
connection, with the same key. Two cases reach an engine whose memory does not hold the key and
whose store holds no result for it:

- On bInference Cloud an install moves to another worker when its lease does
  ([decision 0418](0418-an-install-keeps-a-lease-row-of-its-own-beside-its-agents-rows.md)): a
  worker that lost the lease, or stopped the install, leaves its writes cut where they stood, and
  the client sends them again to the worker that holds the install now.
- On self-hosted the engine stops (a crash, a kill, a power cut) between a write's work and its
  result, and the client sends it again after the restart.

Either way the write runs a second time, though the first may have done its work in part or in
whole. `intent/propose` answers only once the intent waits for the owner or has ended, so its work
spans the quotes, the policy, the risk check and, in auto mode, the execution: a second run is a
second intent, and in auto mode a second trade within the caps. The decision on unique keys left
this open: two replicas that take one key both run the write
([decision 0413](0413-postgres-writes-rerun-once-on-a-unique-violation-and-money-writes-answer-their-own-replay.md)).

What a stopped write can still do is bounded. At most one engine start of an install writes at a
time: the engine lock holds the state folder on self-hosted, and on Cloud every write first passes
the install's lease fence in its own transaction, so a take waits for every write that passed and
none of the old holder's writes passes after it (spec 3, section 6.5). The agent runtime already
treats a proposal the engine did not answer as unknown and never sends it again
([spec 8, section 6.1](../specs/runtime.md#section-6-1)).

## Decision

- **The key is marked before the work.** A write's first step is a store write of its own that
  reads its key and answers:
  - a result stored with the same args hash: that result, as today, and `webhook.url_shown` where
    [decision 0337](0337-a-webhook-rule-keeps-its-mode-and-drops-the-alerts-its-old-url-took.md)
    says;
  - another args hash: `protocol.key_reused`, as today;
  - a key started with no result: unfinished, below;
  - a free key: it marks the key started, with the args hash and the time, and the write runs.

  On Cloud the mark passes the lease fence like any write, so a worker that does not hold the
  install runs no part of a write, the calls it makes outside the store included.

- **The result fills the mark.** A write that answers stores its result, as decision 0337 keeps it,
  in its started row, in a write of its own, before the reply; a `finish` whose started row is gone,
  pruned while a sleeping machine held the write, writes the row whole. Only a refusal the handler
  returns as an outcome removes the mark, so the key may run again. A handler that throws keeps it,
  one that ran past the call's 30-second deadline too: part of its work may have run, and nothing
  tells which part.
- **Its own deadline.** The result's store and the mark's removal run on a 5-second deadline of
  their own, never the server's stop signal, so a write that ended as the engine began to stop
  keeps its result, and the server's close waits for them. A result that cannot be stored is logged
  as `server.result_unkept` and its call fails; a mark that cannot be removed is logged as
  `server.key_kept`, and the key answers `protocol.outcome_unknown` from then on.
- **A running key waits in memory.** The server's map stays as it is: a second call with a key
  this engine start runs waits for the first and gets its answer, other args fail
  `protocol.key_reused`, and a call past the bound of writes running fails `protocol.busy`. The
  store is asked only for a key this start does not run.
- **An unfinished key is final.** A key started with no result, which this engine start does not
  run, was started by an engine start that can write no more: a self-hosted engine that stopped,
  or a Cloud worker that lost the install's lease or stopped it. Its write may have taken effect in
  part, in whole or not at all, and nothing changes that any more. With the same args the key fails
  `protocol.outcome_unknown`, not retryable, until the daily prune removes the row 24 hours after it
  was started; with other args it fails `protocol.key_reused`. No timer ends a mark, so a slow
  worker's write never runs beside a second run of it. The client lists its intents changed since
  it sent the call, through `intent/list` with `changedSince` (the agent's `intents` tool, MCP's
  `binference_intents`), and sends the write again with a new key only if none matches.
- **The rows.** `idempotency` keeps one row per key. `result` is empty while the key is started and
  filled once its write answered; `at` is the time it was started, then the time of its result.
  Engine migration 0065 makes `result` nullable: SQLite rebuilds the table with its rows, and its
  Postgres form drops the `NOT NULL`. The prune removes started rows as it removes results, 24
  hours after `at`, but never the mark of a write the current engine start still runs; the engine's
  daily prune calls it.
- **The port.** `IdempotencyStore` takes `start` (the read and the mark, one write), `finish` (the
  result into the key's started row, or a new row when it is gone; the same result again is done,
  other args or another result `store.constraint`), `forget` (removes a started row with no result
  and the same args hash; a key with none is done) and `prune` (the time, and the keys this start
  runs, which stay). `recall` and `remember` go. Its contract suite runs on the fake, on SQLite and
  on Postgres.
- **Self-hosted.** While the engine runs, most answers stay as they are: a result repeats, other
  args are refused, a running key waits, the bound answers busy, and a refused write frees its key.
  Two cases change: a key whose handler threw or timed out keeps its mark, and a key whose engine
  stopped while its write ran, sent again after the restart, ran the write a second time; both now
  fail `protocol.outcome_unknown`.

## Consequences

- No write runs twice for one key on either profile, across a lease's move, a stop or a crash.
- On self-hosted a write cut by a crash and sent again after the restart answers
  `protocol.outcome_unknown` where it ran a second time before, so a proposal in auto mode can no
  longer trade twice.
- A write whose handler threw, such as a store fault after its intent was stored, or ran past its
  deadline, answers its resend `protocol.outcome_unknown`, where it ran again before: so does one
  that had done nothing yet. A client after `engine.timeout` or no answer at all sends the same key
  again, which answers the first result or `protocol.outcome_unknown`, and never a new key before
  it listed its intents.
- A write cut by a stop costs its client one `protocol.outcome_unknown`, even when the write had
  done nothing yet.
- `protocol.outcome_unknown` is a new error code, an addition to protocol v1, and `intent/list`
  takes `changedSince`, another. Every surface maps the code to words in English and Chinese that
  say binference could not tell whether the change took effect. The runtime treats it as a
  proposal the engine did not answer (spec 8, section 6.1) and tells the model to read its intents
  with `intents` before it proposes again; the MCP server's tool result tells the client to list
  them with `binference_intents`, and a propose tool that got no answer to send its `requestId`
  again.
- Each keyed write costs one more store write, the mark, and a refused one two where it cost one
  read. Measured on SQLite at `synchronous=FULL` on a Mac, 1,000 calls in the test's thread: a
  keyed write 72 to 85 µs before and 135 to 167 µs now, a refused one 5 µs before and 196 to
  315 µs now; through the production worker threads, a read task 47 µs and each write task 94 to
  100 µs. That is one fsync per keyed write more, two in place of one, and two for a refused write
  in place of none; a Mac's fsync leaves the drive's cache, so a Linux disk pays more per sync. A
  streaming turn's `turn/say` drafts, one every 250 ms, cost 0.70 ms each before and 1.31 ms now.
- The Cloud worker's drain needs nothing new: stopping an install leaves its unfinished keys, which
  answer by this rule.
- The Cloud worker's drain needs nothing new: stopping an install leaves its unfinished keys, which
  answer by this rule.

## Alternatives

- **An unfinished key runs again.** It keeps today's answer after a self-hosted stop, and on Cloud
  every failover would run each cut write a second time: a proposal in auto mode could trade twice.
- **Remove every started key when the engine starts.** Self-hosted would keep today's answer
  exactly, with the same second run after a stop; on Cloud the new holder would do the same at its
  take. One line of the start, and the risk above.
- **Answer `protocol.busy`, retryable.** The client would ask again until the prune freed the key
  24 hours later, and then the write would run a second time.
- **Wait for the start that marked the key.** It can write no more, so the wait would never end.
- **End a mark after a time, such as a minute.** A worker paused past it would finish its write
  beside a second run.
- **Tie the mark to the lease's fence.** Self-hosted has no fence, and the server would read one
  on every write. "One engine start writes at a time" covers both profiles with no fence in the
  server: on Cloud each engine start takes the install's lease again, an in-process restart after a
  config change (decision 0395) too, and on self-hosted the engine lock holds the state folder.
- **Store the result in the write's own last transaction.** A write's work spans several store
  writes and calls outside the store, and the server holds no part of them.
- **A table of its own for started keys.** No rebuild of `idempotency`, but every key would be
  read from two tables and kept apart in two places.
