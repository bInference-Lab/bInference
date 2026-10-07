# @binference/chain

The chain-neutral model: CAIP ids, amounts, and the ChainFamily, SigningScheme and ChainRegistry
ports.

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is pure money code: no I/O, no viem, no `Number` or `parseFloat` on an amount, the 95%
  coverage bar, and property tests beside every id and amount module.
- Chains, accounts and assets are CAIP-2, CAIP-10 and CAIP-19 strings, branded and parsed here. A
  malformed id is a `Result` error, never a throw.
- It names no chain, family or venue. `pnpm check:chain-literals` fails a CAIP id, a registry key,
  a hex address, or a `switch` or `===` on a chain id in any pure package.
- A family package implements `ChainFamily` and `SigningScheme` and passes their suites from
  `@binference/chain/testing`. A chain is data in `@binference/chains`, checked by
  `chainDefinitionSchema` and by its family when the registry starts.
- `Signer` is the custody port here, so the engine and each custody adapter
  (`@binference/custody-privy`, a signer service) share it without importing each other. Its fake
  in `@binference/chain/testing` is shaped like a signer service whose owner can remove it.
- `PriceSource` and `UsdPrice` live here so the engine and a chain family's price adapter share
  them; the engine's fake stays in `@binference/engine/testing`.
- Venues are ports here so `engine` and `plugin-sdk` share them: `Quoter`, `TxBuilder` and
  `TxDecoder` in `src/venues/ports.ts`, each with a contract suite. A venue names its contracts by
  their registry names, never by address, and returns `TxDraft`s that only its family reads.
