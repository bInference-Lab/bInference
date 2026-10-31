# @binference/chains

Chains as data: each chain's tokens, contracts, RPCs, relays and explorers, every address checked
on chain.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It holds data only: one file per chain at the top of `src/`, named after the chain's registry
  key (`bsc.ts`), written as a `ChainDefinition` from `@binference/chain`. Nothing here does I/O,
  and it never imports viem.
- Any other file goes in a folder: `pnpm check:chain-literals` reads every top-level file name in
  `src/` as a chain key that pure packages may not spell.
- An address enters only after it was read on chain: code present, proxy slots and owner read, and
  a call that ties it to its siblings. Its `verification` names the project's own public page,
  repo or API and the day it was read. Set `control: "not_read"` while the proxy and owner are
  still unread.
- Every EVM address is written in its EIP-55 checksum form. `bsc.test.ts` fails on an address
  that is not, and on one without a dated, sourced verification record.
- Sources are public pages. Never cite internal notes or local files.
- Contract names are kebab-case and unique within their venue; the venue is the plugin's name.
- Stablecoins on BSC have 18 decimals. Take decimals from the token, never from habit.
- A chain bridges deliver to is read only: no relay, no venue contract but Multicall3, which
  reads a balance. A Solana address is base58 text of 32 bytes, read back with
  `@binference/chain-solana`'s codec by `pnpm chains:read`, never in `pnpm check`.
- `src/venue-calls/` holds the functions binference may call on a chain's staking, bridge and
  identity contracts, read from each project's verified source: a plugin declares these and no
  other. Every address or bytes32 input is pinned to the wallet, bound by a bridge rule, or named
  in its test with why it credits nothing; a call no rule can bind is a bridge wallet's alone.
- `bscBridgeRoutes` lists only routes a bridge's own API serves from BSC, each to a token the
  destination's file lists; a token no route reaches is not listed. Run `pnpm chains:read` after
  a change and keep its report.
