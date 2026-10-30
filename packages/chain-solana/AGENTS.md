# @binference/chain-solana

The Solana chain family, read only: the base58 codec for 32-byte addresses and the delivery read
over Solana's JSON-RPC.

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It only reads. binference holds no Solana key and signs nothing on Solana. The transport refuses
  `sendTransaction` and `requestAirdrop` before any request.
- It is money code: `bigint` lamports and token units, no `Number` on an amount, and the 95%
  coverage bar. Its public API is what `src/index.ts` exports; every export carries TSDoc.
- It names no cluster. Cluster ids, RPCs and mints arrive as a `ChainDefinition` from
  `@binference/chains`.
- Solana's official SDK, `@solana/kit`, does the protocol: addresses through its codec
  (`isAddress`, `getAddressEncoder`, `getAddressDecoder`), signatures through `isSignature`, and
  RPC calls through `createSolanaRpcFromTransport`. A Solana address is base58 text that decodes
  to exactly 32 bytes; nothing else passes.
- Outbound HTTP goes through the core `Http` port: `createSolanaTransport` is the SDK's transport,
  endpoint by endpoint within a timeout. Integers come back as `bigint`, as the SDK's own
  transport parses them. A node's own JSON-RPC error (`src/rpc/solana-node-fault.ts` lists each
  code and its source) moves the call to the next endpoint; an error about the call itself is its
  answer. A 429 or 403 is a public endpoint's rate limit.
- The SDK types its answers but does not check them: every answer passes a zod schema in a
  `*.schema.ts` file before it leaves the package as our own types.
- `DeliveryReader` passes `deliveryReaderContract` from `@binference/chain/testing` on answers
  recorded from mainnet (`src/delivery/recorded/`). Unit tests use no network.
