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
- The signer's `authorize` request (`AuthorizeInput`, spec 5 section 5.1), its parts and its
  `SignerProcess` port live in `src/signing/`, so the engine, `@binference/custody-privy` and
  `@binference/signer` share one shape without importing each other. `SignRequest` carries the
  engine's half of it. `authorizationPayload` is the one copy of Privy's signature payload: the
  signer signs those bytes and custody checks the SDK's bytes against them.
- `PriceSource` and `UsdPrice` live here so the engine and a chain family's price adapter share
  them; the engine's fake stays in `@binference/engine/testing`. A price is an exact ratio, and only
  its caller rounds. `withQuotePrice` gives a trade's other token the price of its own quote, for
  the engine step that holds the quote.
- Venues are ports here so `engine` and `plugin-sdk` share them: `Quoter`, `TxBuilder` and
  `TxDecoder` in `src/venues/ports.ts`, each with a contract suite. A venue names its contracts by
  their registry names, never by address, and returns `TxDraft`s that only its family reads.
- `TxSimulator` (`src/simulation/ports.ts`) is the I/O half of a family: it runs drafts unsent on
  the chain's latest state and reports each step's transfers and approvals as CAIP ids and amounts,
  never the fee, so the engine checks them without importing a family package. Balances it is
  given, such as a paper portfolio's, replace the sender's on the chain for that run.
