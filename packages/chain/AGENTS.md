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
  the engine step that holds the quote, except a token its source answers `price_refused` for
  (decision 0328): that refusal is final.
- Venues are ports here so `engine` and `plugin-sdk` share them: `Quoter`, `TxBuilder`,
  `TxDecoder` and `PriceReader` in `src/venues/ports.ts`, each with a contract suite. A price read's
  calls carry their input in their family's encoding, so the family batches them; its `price` step
  is pure and answers `unpriced` or `replan`, never a throw. A venue names its contracts by their registry
  names, never by address, and returns `TxDraft`s that only its family reads.
- `TxSimulator` (`src/simulation/ports.ts`) is the I/O half of a family: it runs drafts unsent on
  the chain's latest state and reports each step's transfers and approvals as CAIP ids and amounts,
  never the fee, so the engine checks them without importing a family package. Balances it is
  given, such as a paper portfolio's, replace the sender's on the chain for that run.
- Sending is three ports in `src/sending/` that a family fills: `TxPreparer` gives a draft its
  nonce, gas and fees, or makes a speed-up or a cancel at a signed transaction's nonce for at
  least `leastReplacementFee`; `RelaySender` sends signed bytes to every private relay at once and answers
  each relay apart, never retrying; `ReceiptReader` reads receipts and the chain's head by its
  finality rule, what a mined transaction moved, an account's nonce as of a block, and the native
  coin an account received in a block (decision 0108). Their fake, `createFakeNetwork`, mines only
  when a test says so.
- `DeliveryReader` (`src/delivery/ports.ts`) reads, on a chain a bridge delivers to, an
  account's holding of an asset and what one transaction brought it in one asset, with its block
  and whether that block is final. It only reads, so a family that never signs, such as Solana's,
  fills it too.
- `Bridge` (`src/bridges/ports.ts`) quotes a bridge route, builds and decodes its deposit, and
  tells a deposit's status by the bridge's word, which only says where to read: the destination
  chain's `DeliveryReader` says whether funds arrived. It declares its contracts like a venue, so
  ceilings hold its deposit's rules, and names each destination with the id its deposit uses.
- `NameResolver` (`src/names/ports.ts`) answers what a name under one suffix points to on its
  chain at the latest block, and its reverse record, reading again on every call. Naming-service
  plugins fill it; the engine picks one by the name's suffix and names no service.
- `StakingVenue` (`src/staking/ports.ts`) lists a staking venue's validators, reads a wallet's
  stake and unbonding coin, names the receipt token a stake with a validator mints, plans a stake, an unstake or a claim at the latest block, live or
  against a paper position, or names why the venue would refuse it (`stakeRefusals`), builds the
  planned call, decodes one back, and reads back what a landed move did. Every
  call it builds or decodes credits the account that signs; it declares its contracts like a venue,
  so ceilings hold their rules. A liquid staking venue declares its one `pool`, which stands
  where a validator does, names an unstake in its receipt token, approves exactly those units
  before the unstake's call, and lets its own queue say when a part is ready (decision 0331). It
  and its terms are exported from `@binference/chain/staking`, since the root entry is at its size
  limit.
- `IdentityRegistry` (`src/identity/ports.ts`, decision 0335) writes an agent's registration file,
  reads a wallet's standing (the registry's version, the identity tokens it holds and the contract
  its proxy runs, held to the one the plugin pins), builds the
  one call that registers a file and mints the token to the wallet that signs, decodes only that
  call, counts the tokens a simulated step minted from the step's raw logs, and reads back a landed
  registration. It and its terms are exported from `@binference/chain/identity`.
