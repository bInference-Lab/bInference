# 0209. A recorded day replays on today's pools to time exit fills by block

Status: Accepted

Accepted by the owner on 2026-10-13.

## Context

The orders' goal is that, on a fork replay of a real day, take-profit, stop-loss and trailing fills
go out within one block of their trigger, inside their bounds, with no model call. The price
watcher reads every block ([decision 0192](0192-the-price-watcher-reads-every-watched-token-in-one-batch-at-each-block.md))
and the triggers hand a fill to the order fills in the same processing
([decision 0196](0196-a-price-trigger-fires-on-its-level-at-each-confirmed-price.md)). The facts:

- BNB Smart Chain makes a block every 0.45 s: 191,400 blocks on 2026-10-12 (UTC).
- Public BSC nodes keep the state of about the last 128 blocks, under a minute. A fork of a past
  day needs an archive node; a fork near the head serves only what anvil read in its first minute.
  Past that, anvil panics on `missing trie node` when it mines a block whose EIP-2935 history slot
  it never read, and fails any read of a slot it never read.
- BNB Chain's nodes refuse `eth_getLogs`. 48 Club's public node (`https://rpc.48.club`, the URL its
  documentation gives) serves it and allows 80 calls in 5 s and 720 a minute from one address, as
  its `x-ratelimit-limit` header says. The owner chose it for the recording on 2026-10-13.
- A fork test file must finish within about 40 s, and the full day block by block at 0.45 s takes
  a day.
- A watcher learns of a block by a pushed `newHeads` or by a poll once a block time
  (decision 0192); a poll sees a block up to a block time after it was made.

## Decision

- **The recording.** `pnpm replay:record` reads one UTC day's `Sync` events of the PancakeSwap v2
  pairs of three registry tokens with WBNB (BTCB, ETH and Cake) from 48 Club's public node, 1,000
  blocks a call, one call at a time with a pause, backing off on 403, 429 and 5xx and when the
  rate headers run low. Each pair keeps the reserves after each block's last trade, as the token
  and WBNB, with the price they make, when the price moved at least 1 bps from the last block
  kept, and its first and last block. The result is the fixture
  `packages/chain-evm/src/replay/days/<day>.json`; the raw logs are never committed.
- **The replay.** It runs on the fork near the head, on today's pairs. Each pair moves to its
  recorded price as a share of its price when the replay starts, by one swap a block from the test
  account straight to the pair, the least amount in that reaches the price after the pair's fee.
  The test account is funded in the tokens' own storage, so no pool moves before the replay does.
- **Quiet stretches compressed.** A recorded block is replayed when one of its pairs moved at least
  5 bps from where the replay last put it; every pair it moves moves in one block, and the blocks
  between are left out. A replayed pair never stands more than 5 bps from its recorded path.
  2026-10-12's 702 recorded blocks replay as 192.
- **The fork's state.** Before the first block the replay simulates a small swap each way on each
  pair and sets the history slots of its blocks and 64 more, so nothing is read from the node
  later; every replay test pins the fork again first.
- **The pace.** A block is mined a block time after the one before, whatever the engine does.
- **The measure.** A fill's trigger block is the block whose price fired it. A paper fill is sent
  when it is written; it lands in the first replayed block mined after that. Trigger-to-fill is
  the landing block less the trigger block: 1 is "within one block". The harness also gives the
  time from the trigger block's mining to the head seen, the price read and the fill written.
- **Within one block holds with pushed heads.** The replay run asserts, with heads pushed over a WebSocket, that
  each fill lands one block after its trigger and is written within one block time of it. With
  heads polled once a block time, it asserts two blocks at most and a fill itself under one block
  time. Both runs assert that each exit fired at the first replayed block its trigger allowed and
  stayed inside its bounds.
- **A suite of its own.** Replay tests are `*.replay.test.ts` files in a package's `src/fork/`,
  run by `pnpm test:replay` (`vitest.replay.config.ts`, five minutes a test), never by
  `pnpm check` or `pnpm test:fork`. The nightly fork job runs it after the fork suite.

## Consequences

- One recorded day measures the triggers and fills at the chain's pace on the real pairs' code,
  with no archive node and no key. Another day is one `pnpm replay:record` run and a fixture.
- Replaying 2026-10-12 with pushed heads, every fill was written 17 to 42 ms after its trigger
  block was mined, over four runs: at most 1 ms to see the head, 1 to 4 ms to read the prices and
  15 to 40 ms to fill. With polled heads, seeing the head took 61 to 262 ms of two runs' 80 to
  302 ms; every fill still landed in the next block, but a poll late in its block time puts a fill
  two blocks after its trigger.
- Live exit orders keep within one block only with a `wss:` endpoint
  (`chains.rpc.<chain>.ws`); over a public node's polling, a fill can land a block later.
- A take-profit holds its level at its quote's least out (decision 0197), so its pool must stand
  above the level by the pair's fee and the slippage; the replay's take-profits ask 0.1% slippage
  and sit under the day's high by the fee, that slippage and 0.05% more.
- The replay suite takes about three and a half minutes, past the fork suite's budget per file.

## Alternatives

- **A fork at each block of the past day.** It needs an archive node and a key. Rejected.
- **Replay every recorded block.** 702 blocks take over five minutes a run, for moves under 5 bps.
  Rejected.
- **Set the reserves in the pair's storage.** It skips the pair's own code, its `Sync` event and
  its price accumulators, which a swap runs. Rejected.
- **Mine as fast as the engine keeps up.** The blocks would wait for the fills, so nothing would
  be measured. Rejected.
- **Commit the raw logs.** 348 KB of logs for 69 KB of prices, and raw dumps stay out of the
  repository. Rejected.
