# 0262. A leader read of a block again drops the trades it no longer holds

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0250](0250-the-leader-watcher-reads-every-block-once-within-a-budget-and-resumes-where-it-stopped.md)
reads every block once and, after a reorganization, reads again from the chain's last final
block. Its consequences keep a trade a reorganization removed, and may store one it moved twice.
Copy orders now act on these rows ([decision 0260](0260-a-copy-order-copies-each-leader-trade-once-at-its-own-size-inside-its-caps.md)):
a removed trade would be copied though it never happened, and a moved one copied twice.

## Decision

- **A read is the truth for the blocks it reads.** In the write that stores a read, each tracked
  wallet the read covers loses its stored trades in the blocks from the read's first block, or the
  wallet's own first, to its last, that the read's trades no longer hold, by account, transaction
  hash and log index. A block the read cut for a wallet keeps that wallet's rows. A first read of
  new blocks finds none to drop; only a read again after a reorganization does.
- **Numbers are never reused.** A dropped trade's number is not given again, so a copy order that
  read past it reads on from where it was.
- Copy orders add their own guards (decision 0260): a trade is copied once per order by its
  transaction hash, side and token, and only once its block is deep enough behind the watcher's
  cursor for a reorganization to have been read again.

## Consequences

- `TrackedWalletStore.record` drops such rows in its write; its SQLite task, its fake and its
  contract suite do.
- `wallet/activity` no longer lists a trade a reorganization removed once its blocks are read
  again.
- Decision 0250's consequence that a removed trade stays stored no longer holds.

## Alternatives

- **Keep removed trades and check each against the chain before copying it.** One more chain
  read for every copy, through a port the engine does not have. Rejected.
- **Store each trade's block hash and compare it.** A migration of `wallet_activity`, and every
  reader would compare. Rejected for the read that already knows.
