# 0251. The writes that start and end a wallet's tracking keep tracked wallets

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 3](../specs/database.md) section 2.6 has `tracked_wallets` hold each account an active copy
order names as its leader or an active wallet alert names: the write that makes such an order or
alert active adds the row or clears its `untracked_at`, and the write that ends the last of them
sets it. An install tracks at most 50, counting the leaders of copy orders that await their card
([spec 1](../specs/protocol.md) section 8.4). Until the leader watcher kept the table,
[decision 0244](0244-an-alert-is-set-with-no-card-and-its-setter-or-the-owner-deletes-it.md) had
the store count the distinct accounts of active wallet alerts. The specs leave open:

- **Which order states hold a slot.** A paused copy order resumes when its agent is unfrozen.
- **What a row tracked again keeps** of its last span.

## Decision

- **One rule, in every write that can change it.** Each write that creates, deletes, ends or
  expires a wallet alert, and each that creates or moves a copy order, reads again whether the
  account still has a reason to be tracked, in the same transaction: an active wallet alert, or a
  copy order awaiting its card, active or paused, of an agent not archived. It adds the row,
  clears its `untracked_at`, or sets it.
- **The cap counts the rows** without `untracked_at`. A wallet alert or copy order on a 51st
  account is `track_limit`; one on an account already tracked passes.
- **A row tracked again** starts a new span: its `since_block` and `last_block` are cleared, and
  the leader watcher sets them at its next read. The trades it stored before stay.
- **Migration 0042** creates `tracked_wallets`, `wallet_activity` and `watch_cursors`, and adds a
  row for each account of an active wallet alert of an agent not archived. No copy order existed
  before: `order/create` refused the kind.

## Consequences

- `wallet/activity` reads a wallet the agent tracks from `wallet_activity`, and the agent's own
  wallets from their executions.
- A copy order gets its slot from the order store's create and moves, with no code of its
  own for the cap.

## Alternatives

- **Count the slots from alerts and orders at each check.** The leader watcher would read two
  tables and the agents at every block. Rejected for one table the writes keep.
- **Free a paused copy order's slot.** Another alert could take it while the agent is frozen, and
  the order could not resume. Rejected.
- **Keep the old span's blocks.** `since_block` would claim a span with a gap in it. Rejected.
