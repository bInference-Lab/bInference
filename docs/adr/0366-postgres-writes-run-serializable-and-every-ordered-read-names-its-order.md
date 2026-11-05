# 0366. Postgres writes run serializable and every ordered read names its order

Status: Accepted

Accepted by the owner on 2026-11-05.

## Context

On SQLite each database has one writer: write tasks run one at a time, in arrival order, each in
one transaction, and reads run on reader connections that each see one committed snapshot
([ARCHITECTURE.md section 17](../ARCHITECTURE.md#section-17), `packages/store/AGENTS.md`). A write
task rereads the rows it decides on inside its transaction and writes nothing before its outcome is
known. Many write tasks decide on more than one row: the rolling 24-hour cap sums the confirmed
intents of a day, an agent holds at most 20 webhook rules, one open question per agent, the next
nonce, the ledger's next entry and its previous hash. One writer makes each of those checks hold by
construction.

On Cloud several services write one install's tables: the worker that holds its agents, the
ingress that stores a user's confirmations and updates, and the signer service that reads what it
signs ([ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)). The Postgres manual
("Transaction Isolation") says `READ COMMITTED` lets two transactions each read a sum or a count and
each write past it, while `SERIALIZABLE` gives the outcome of some serial order and refuses a
transaction that would break it with SQLSTATE `40001`.

Order is the second gap. SQLite returns rows of an equal sort key in `rowid` order. `order_fills`
breaks the tie of one millisecond on `rowid` today, so the newest written row reads first. Postgres
has no `rowid`. Our ids are UUIDv7: the milliseconds, then random bits, so an order on `id` is the
same on both databases but is not the order rows were written within one millisecond. A backup made
with `VACUUM INTO` may also renumber `rowid`, so after a restore those `order_fills` rows can read in
another order. Text order differs too: SQLite compares text byte by byte, and Postgres compares it
by the database's collation unless a column says `COLLATE "C"` (the manual's "Collation Support").

## Decision

**Isolation.**

- Every Postgres write task runs at `SERIALIZABLE`, read write. Every read task runs at
  `REPEATABLE READ`, read only: one snapshot per task, as a SQLite reader sees.
- The worker keeps the store's one writer per database: an install's write tasks run one at a time,
  in arrival order. Other services' writes interleave with it under the same isolation.
- A write task that fails with `40001` or `40P01` (deadlock) runs again from its first read, at
  most three times more, after 10, 40 and 160 ms with jitter, then fails `store.write_conflict`.
  A retry is safe because a store task makes no network call and returns nothing before `COMMIT`:
  the database is its only effect. No other error is retried.
- A connection lost or aborted while `COMMIT` is in flight fails `store.commit_unknown` and is never
  retried; the caller rereads before it decides again.
- Transactions stay short: no network call inside one, and the session timeouts of
  [decision 0365](0365-the-postgres-store-runs-on-node-postgres-through-kysely-s-built-in-dialect.md)
  end one that waits.
- On Cloud a worker's write task first checks its install's lease fence in the same transaction
  (spec 3, section 6.5).

**Order.**

- Every ordered read sorts on columns the schema holds and ends with a column, or columns, unique
  among the rows it reads, so the order is total and the same on both databases. A contract case
  pins each such order on both adapters.
- Every Postgres text column is `COLLATE "C"`, so text sorts, compares and matches a prefix range
  byte by byte, as on SQLite.
- Numbers stored as decimal text on SQLite, such as block numbers, are `numeric(78,0)` on Postgres
  and sort as numbers without a cast.
- Where a read means the order rows were written (a newest-first list, a queue in arrival order, a
  cursor that must not skip a row), the table holds an integer write-order column. Each write takes
  the next value inside its own transaction: on SQLite under the one writer, on Postgres from a
  counter row it updates in the same transaction, so values follow commit order and are never
  reused. The integer keys that carry write order today (`ledger.seq`, `inbox.id`, `outbox.id`,
  `config_journal.id` and the rest in spec 3, section 6.4) are assigned the same way on Postgres,
  never from an identity column or a sequence, whose values follow the order transactions began,
  not the order they committed.
- `order_fills`, `notices`, `agent_inbox` and `chat_queue` gain a `seq` column of this kind on both
  databases, filled for existing rows in their current order, and their reads that mean write order
  sort on it. `order_fills` no longer reads `rowid`, so a restore keeps its order.
- A search that ranks notes by relevance is the one read whose order is the adapter's own:
  FTS5's rank on SQLite, trigram similarity on Postgres. Its contract cases pin which notes come
  back and that equal ranks break on `id`, not the rank itself.

## Consequences

- A money check that reads many rows holds on Postgres as it does under SQLite's one writer, with no
  lock to choose per statement.
- Under contention a write may run up to four times; the retry count and the time it took go to the
  log, and a rising count is a signal for the load test.
- The four new `seq` columns need an engine migration and an agent migration on SQLite before the
  Postgres adapter lands. Their reads change in the same change, with a contract case each.
- One writer per database stays a store rule on both adapters, so a self-hosted behavior does not
  change to fit Cloud.
- A read whose tie-break is a UUIDv7 id stays deterministic on both databases; it does not promise
  write order within one millisecond, and spec 3 marks each such read.

## Alternatives

- **`READ COMMITTED` with row locks per statement family.** Fewer retries, but each of 128 write
  tasks would need its own lock, chosen by hand: a lock on the agent's row for the 24-hour cap, on a
  counter for the rule limit, on the ledger head. A missed lock passes every single-writer test and
  breaks only under concurrency, which is where money is lost.
- **`REPEATABLE READ` for writes.** It still allows write skew between two writers that read the
  same rows and write different ones, the 24-hour cap among them.
- **Identity columns or sequences for write order.** Their values follow the order transactions took
  them; a reader paging after a value can skip a row that commits late.
- **Ordering on `created_at` and the id alone.** UUIDv7's random bits make rows of one millisecond
  read in a random but fixed order, which is wrong where the newest written row must read first.
- **A database collation of `C`.** It depends on how each managed database was created; a column
  collation holds wherever the schema is made.
