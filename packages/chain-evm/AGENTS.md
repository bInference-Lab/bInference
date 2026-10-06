# @binference/chain-evm

The EVM chain family: viem clients behind RPC failover, fees, simulation with transfer traces,
calldata decoding and the EVM signing scheme.

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is money code: `bigint` wei, no `Number` or `parseFloat` on an amount, and the 95% coverage
  bar. Its public API is what `src/index.ts` exports; every export carries TSDoc.
- It names no chain. Chain ids, RPCs, tokens and contracts arrive as a `ChainDefinition` from
  `@binference/chains`.
- Every RPC answer passes a zod schema before it leaves the failover, and leaves the package as our
  own types: CAIP ids, `Amount`, `bigint`. A `*.schema.ts` file holds every `unknown`.
- Outbound HTTP goes through the core `Http` port. viem's own transports and retries stay unused:
  viem clients ride on `createRpcFailover` through `createEvmClient`.
- The failover reads. It refuses `eth_send*`, `eth_sign*`, `personal_*` and `wallet_*`, so a retried
  send can never reach a public node; sends go through the private relays.
- `src/testing/` holds test support: fake and loopback `Http` adapters and loopback servers. It is
  the one place that imports `node:http`, and nothing outside tests imports it.
- Unit tests use no network: fakes, or servers on 127.0.0.1.
