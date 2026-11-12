# 0418. An install keeps a lease row of its own beside its agents' rows

Status: Accepted

Accepted by the tech lead on 2026-11-12.

## Context

On Cloud a worker holds an install through its rows of `cloud.agent_leases`, one row per agent,
and every write it makes in the install's schemas first checks, in its own transaction, that rows
exist and each names the worker and its fence and has not expired
([spec 3, section 6.5](../specs/database.md#section-6-5)). `create_install(install_id)` inserts the
install's first rows free (section 6.6), but it runs at sign-up, before the install has an agent:
the engine makes the first agent later, with a write that must already pass the check. An install
whose last agent was deleted has no row either. With no row, no worker can take the install and
every write to it fails, the first agent's own among them.

The spec is also silent on four points a build must settle: when a row has expired, what a take
answers while a holder's write is in flight past the lock timeout, whether a new agent's row may
be added or a deleted one's removed by a worker that does not hold the install, and how a store
host is tied to the install whose lease it carries.

## Decision

- `create_install()` inserts one row for the install itself: `agent_id` empty, no worker, fence 1,
  `expires_at` 0. Nothing deletes it. Each agent's row joins it; a take, a renewal, a clean stop
  and the fence check of every write cover all the install's rows, its own among them.
- A row has expired once `expires_at` is at or before the database's `clock_timestamp()` in epoch
  milliseconds.
- A take locks the install's rows `FOR UPDATE`, then reads the database's clock, so a write that
  passed the check ends before the take decides. It answers `held` while any row has not expired,
  and also when a write keeps the rows locked past `lock_timeout`; `not_found` when the install has
  no row.
- A new agent's row, a copy of the install's own row under the agent's id, and a deleted agent's
  removal are writes like any other: they pass only while the caller's lease holds, and a row
  already there, or already gone, answers as done.
- A Postgres store host carries one held lease and refuses, at its start, a schema that is not one
  of that install's two (`store.lease_mismatch`). A host with no lease refuses every write with
  `store.lease_lost` before it reaches the database.
- No Cloud database exists yet, so no migration adds rows for installs made before this.

## Consequences

- An install can be taken and written from sign-up on, with or without agents.
- A row with an empty `agent_id` is the install's, so the take scan and the ingress, which reads
  the holder, find every held install through it.
- A worker's write and its own renewal take conflicting row locks: a renewal waits for the writes
  in flight, which stay short.
- The engine and the runtime must call the lease port when they create or delete an agent on
  Cloud; nothing calls it yet.

## Alternatives

- `create_install(install_id, agent_id)` with the first agent's row: sign-up would choose the
  engine's first agent, and an install whose last agent was deleted would still have no row.
- A lease table keyed by the install alone: it drops the per-agent rows spec 3 section 6.5 and
  ARCHITECTURE.md section 30 keep for moving agents later.
- A take that fails on the lock timeout as a fault: the take scan would log a fault each time a
  holder writes for longer than two seconds, which is an install held, not a failure.
