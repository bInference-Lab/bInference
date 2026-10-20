# 0250. The leader watcher reads every block once, within a budget, and resumes where it stopped

Status: Amended by 0262

Accepted by the owner on 2026-10-19.

## Context

[Spec 3](../specs/database.md) section 2.6 gives the leader watcher a fixed budget per block,
whatever the number of tracked wallets, `overflow_blocks` on each tracked wallet for the blocks
whose reads the budget cut, and `watch_cursors`: after an outage the watcher checks that its last
block still has its hash, then reads on from the block after it, else from the chain's last final
block. The leader watcher's task asks for a stated overflow policy: what is dropped, and how the
watcher catches up. The facts:

- A copy order that misses a leader's sale keeps a position the leader left. Unlike a price, a
  skipped block cannot be made up by a later one.
- Providers bound `eth_getLogs` differently: Alchemy's free tier reads at most 10 blocks a query
  and caps an answer at 150 MB; BlockPI's public endpoints 1,024 blocks; others refuse an answer
  over 10,000 logs with -32005. Some say so in their message only.
- A wallet that makes hundreds of transfers in one block, such as an exchange's or a disperser's,
  makes no trade a copy order or an alert could follow, and its transfers alone could fill a
  provider's answer.
- BNB Smart Chain makes a block every 0.45 s and finalizes within a few.

## Decision

- **Every block, in order.** The watcher reads each block after the last one it read, with no
  skip: one query pair for the newest block at the head, and up to 10 blocks a pair behind it, the
  smallest range a documented provider allows. A block's header is read for its hash, and the
  first block's parent hash must be the hash stored for the block before; when it is not, the
  chain reorganized, and the watcher reads again from the chain's last final block.
- **A time budget.** Each call gives one endpoint 1,500 ms before the next is asked, as the price
  watcher's reads do. A read that fails stores nothing and is tried again a block time later, from
  the same block.
- **A log budget per wallet.** A wallet with more than 100 transfers in one block is cut for that
  block: none of its trades there are stored, `overflow_blocks` counts the block, and the log
  records `watcher.wallet_overflow` with the chain and the account. The other wallets
  of the block are read in full. A cut block is never read again for that wallet: the same
  transfers would meet the same budget.
- **The owner hears of it** (the owner's choice, 2026-10-19). A tracked wallet with cut blocks
  sends `notice.walletOverflow` at most once a day, naming the wallet by an address book label of
  an agent that tracks it, else by its short address, and how many of its blocks were cut since
  its last notice: "Whale's trades in 3 blocks were too many to read; copy orders and alerts
  missed them." Blocks cut within the day are told with the next notice. `tracked_wallets` keeps
  the blocks told and when (migration 0043).
- **A query too large for the endpoint** is asked again over half its range, down to one block,
  then with the tracked addresses in halves; a single wallet whose one block an endpoint still
  refuses is cut in the same way.
- **One write per read.** The trades of a read, every tracked wallet's `last_block` and
  `overflow_blocks`, and the cursor with the last block's hash are stored in one transaction. A
  trade's row is kept once on `(account, tx_hash, log_index)`, so a read done twice stores
  nothing twice, and only rows stored new are handed to the alerts.
- **Resume.** The watcher starts from its cursor, checked by its hash, however far behind; with no
  cursor, from the newest block. A wallet starts at the next block read after it is tracked
  (`since_block`), and a gap is never filled from history.

## Consequences

- An outage of an hour on BNB Smart Chain is caught up in about 800 query pairs.
- Log records gain `accountId`, an account's CAIP-10 id.
- A trade a reorganization moved to another position in its block may be stored twice; one it
  removed stays stored. BNB Smart Chain's fast finality makes both rare.
- Spec 4 gains `notice.walletOverflow`, in English and Chinese; it names no agent, and no agent
  mutes it.

## Alternatives

- **Skip to the newest blocks when behind,** as the price watcher does. A leader's sale in a
  skipped block would never be copied. Rejected.
- **Read a cut block again later with more budget.** The budget exists for the block that would
  break it. Rejected.
- **A range per endpoint in config.** One more setting for the owner to know, for a catch-up that
  10 blocks a pair already makes fast. Rejected.
- **Read only final blocks.** About a second later for every copy. Rejected for the parent check.
