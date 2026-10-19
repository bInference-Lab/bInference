# 0256. The launch feed reads every launchpad in one log query a block

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 1](../specs/protocol.md) pushes `launch/new` once for each launch, in block order, and
serves the launches through `launch/list` and `market/scan`; [spec 3](../specs/database.md) keeps
them in `launches` with the feed's cursor in `watch_cursors`. The feed must resume after an outage
with no gap and no double, and hand each stored launch to the alerts
([decision 0245](0245-an-alert-fires-once-per-match-tells-the-owner-and-wakes-the-agent-marked.md)).
Each launchpad reads its launches from their transaction's logs
([decision 0254](0254-a-launchpad-reads-its-launches-from-their-transaction-s-logs.md)). The facts:

- The leader watcher already reads every block in order from a cursor checked by its block's hash,
  up to 10 blocks a read behind the head, and reads again from the last final block after a
  reorganization
  ([decision 0250](0250-the-leader-watcher-reads-every-block-once-within-a-budget-and-resumes-where-it-stopped.md)).
- Log queries go to 48 Club's public node unless the owner names an RPC; it allows 720 requests a
  minute, and the leader watcher asks about 264 at the head
  ([decision 0252](0252-log-queries-go-to-48-club-s-public-node-until-the-owner-names-an-rpc.md)).
- On 2026-10-19 Flap launched 4 tokens in 1,000 BSC blocks, all within 11 blocks; Genius.fun 4 in
  60,000. A spammer can launch many tokens in one block.
- Genius.fun's exemptions come from each launch's own curve, which no registry lists, so a query
  limited to registry addresses misses them.

## Decision

- **One block reader.** The feed runs on the block reading the leader watcher uses
  (`createLogWatch` in `@binference/chain-evm`): the same cursor, hash check, final-block fallback,
  spans of at most 10 blocks and retries. With no cursor it starts at the head: it never reads a
  history from before it first ran.
- **One log query a read.** Every launchpad's declared events, as topic0 values, from any
  contract, through the log endpoints. An answer refused as too large is asked again in halves;
  a block refused even alone fails the read, which is tried again.
- **A fixed budget.** Beside the log query, a read asks one header for each block that holds a
  launch, for its time, and one Multicall3 call that completes at most 50 launches, at the span's
  last block when it is the newest, else at the latest. Launches past 50 keep their logs' facts. At
  the head this adds about 132 log queries a minute to the leader watcher's, under the node's 720.
- **When it runs.** Whenever the engine runs, on each chain whose registry lists a launchpad that
  reads launches; no key is needed (ARCHITECTURE rule 16). Without one, `market/scan` with
  `source: launches` fails `market.no_launch_feed`.
- **Once, in order.** Each read is stored in one write with its cursor; after the write, each launch
  stored new is pushed as `launch/new` and handed to the alerts' `seeLaunch`, in block and log
  order. A crash between the write and the telling tells that read's launches to no one; they stay
  in `launch/list`.
- **Faults.** A failed read is logged as `watcher.launch_read_failed` once for each new reason and
  tried again a block time later; the feed never stops for the chain.

## Consequences

- `@binference/chain-evm` exports `createLaunchWatcher`; the leader watcher moves onto the shared
  block reader, unchanged in behavior.
- four.meme and Brew join the feed by declaring their launch reading; the feed's budget stays one
  log query a read whatever the number of launchpads.
- A launch's liquidity is not read, so a launch filter with `minLiquidityUsdMicros` never passes
  one from the feed.

## Alternatives

- **A query per launchpad, limited to its contracts.** The budget would grow with each launchpad,
  and a launch's own contracts would need a second query. Rejected.
- **Log subscriptions over WebSocket.** Not every endpoint serves them, and a dropped socket loses
  logs with no cursor to resume from. Rejected.
- **Wait for the owner to name an RPC.** Launch alerts would wait on a setting most owners never
  make. Rejected, as for the leader watcher.
