# @binference/chain-evm

The EVM chain family: viem clients behind RPC failover, fees, simulation with transfer traces,
calldata decoding and the EVM signing scheme.

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is money code: `bigint` wei, no `Number` or `parseFloat` on an amount, and the 95% coverage
  bar. Its public API is what `src/index.ts` exports; every export carries TSDoc.
- It names no chain. Chain ids, RPCs, tokens and contracts arrive as a `ChainDefinition` from
  `@binference/chains`, which only the fork tests in `src/fork/` may import; the package graph
  enforces it.
- Every RPC answer passes a zod schema before it leaves the failover, and leaves the package as our
  own types: CAIP ids, `Amount`, `bigint`. A `*.schema.ts` file holds every `unknown`.
- Outbound HTTP goes through the core `Http` port. viem's own transports and retries stay unused:
  viem clients ride on `createRpcFailover` through `createEvmClient`. The one socket, the block
  source's `newHeads` subscription (`src/watching/`), opens through a `HeadSocketFactory` the
  composition root gives; its URL may carry a key, so no error, state or log names it.
- The failover reads. It refuses `eth_send*`, `eth_sign*`, `personal_*` and `wallet_*`, so a retried
  send can never reach a public node; sends go through the private relays.
- A node that pruned the state a read needs is a `missing_state` fault, not a failure: the read
  moves on, and once every endpoint pruned it, it fails as `chain.state_missing`, which no retry
  mends. Only the owner's tracing RPC answers then (decision 0108).
- The relay sender (`src/sending/`) sends each signed transaction to every relay at once, once,
  each request with its own timeout. A relay's error becomes a `RelayRefusal` by its code or its
  documented text (`relay-refusal.ts` cites each source); the text itself goes nowhere. A new
  documented error is a line there and a case in its test.
- The price watcher (`src/watching/`, decision 0192) reads every watched token's price reads and
  their quote assets' feeds in one Multicall3 `aggregate3` call at each new block, encoded here and
  never split, with the block's number as the call's block. It never stops for the chain: a dead
  socket gives way to polling, a failed batch is read again, and its lag is reported, not thrown.
  Its loops run through `repeatSteps`, so a run of hours never chains promises up.
- Prices come from the Chainlink feeds the composition root names. A feed that cannot be read, a
  broken answer, or one older than its heartbeat plus 30 s is `no_price`, never a throw.
- No key lives here. The signing scheme builds, hashes and checks what a signer signs.
- `src/testing/` holds test support: fake and loopback `Http` adapters and loopback servers. It is
  the one place that imports `node:http`, and nothing outside tests imports it.
- Unit tests use no network: fakes, or servers on 127.0.0.1. Fork tests live in `src/fork/` and
  run in the fork suite (`pnpm test:fork`, see the README), never in `pnpm check`. They run inside
  `withFork` and reach only the suite's loopback endpoints.
- `src/replay/` holds the pure parts of the replay (decision 0209): a recorded day's price path
  and its fixtures in `days/`, the recorder's reduction of `Sync` logs, the compression of quiet
  stretches and the swap that moves a v2 pair to a price; their unit tests run in `pnpm check`.
  `src/fork/day-replay.ts` drives them on the fork; replay tests (`*.replay.test.ts`) run in
  `pnpm test:replay` only. `pnpm replay:record` writes a new day from 48 Club's public node.
