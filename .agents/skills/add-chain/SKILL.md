---
name: add-chain
description: Adds an EVM chain, or new tokens and contracts on a chain, to the registry in @binference/chains, each address read on chain first. Use when a chain, a token or a venue's contract address joins the registry.
---

# Add a chain

A chain is data. The engine never names one: it reads the registry. Adding an EVM chain is a file
in `packages/chains`, its venue addresses and fork tests; nothing in `engine` changes. A new chain
family (not EVM) is a new package instead and needs its own ADR.

## 1. Decide first

v1 enables BSC only (decision 0023). A new chain that owners can turn on needs the maintainers'
yes: write the ADR with `write-adr` before the code. Tokens and contracts on BSC need no ADR.

## 2. Read every address on chain

An address enters the registry only after you read it on the chain itself:

- code is present at the address;
- for a proxy, the implementation and admin slots, and the owner, are read;
- one call ties it to its siblings (a router's factory, a pool's tokens, a token's decimals);
- the source is the project's own public page, repo or API, never a forum post, a block
  explorer's label alone, or a local note.

Write each address in its EIP-55 checksum form. Take decimals from the token's `decimals()`:
stablecoins on BSC have 18.

## 3. Write the data

- One file per chain at the top of `packages/chains/src/`, named after the chain's registry key
  (`bsc.ts`), exported as a `ChainDefinition` from `@binference/chain`: the CAIP-2 id, the key,
  the name, the family, the native asset, the block time, the finality rule, RPCs, relays,
  explorers (each with its `txUrl` transaction page, `{hash}` where the hash goes), tokens and
  contracts.
- Every token and contract carries a `verification`: its source URL, the day you read it and
  `control: "read"` (`"not_read"` while the proxy and owner are still unread).
- Contract names are kebab-case and unique within their venue; the venue is the plugin's id.
- The chain's ceiling caps and price feeds sit beside it, as `bsc.ts` exports `bscCeilingCaps` and
  `bscPriceFeeds`.
- Export the new values from `packages/chains/src/index.ts`. Any helper file goes into a folder:
  `check:chain-literals` reads every top-level file name as a chain key.
- Pure packages (marked `pure` in `config/package-graph.json`) never spell a chain: no `eip155:`
  literal, chain id, chain key or hex address.

## 4. Wire it

- The composition root lists the chains it serves (`selfHostedChains` in
  `packages/cli/src/compose/open-engine-parts.ts`).
- The config schema in `packages/cli/src/config/schema/chains-venues.schema.ts` holds the chain's
  defaults, such as its network fee cap. Run `pnpm check:config-schema --write` and commit the
  regenerated snapshot and key reference.

## 5. Test

- The chain's `*.test.ts` beside its file, like `bsc.test.ts`: the definition parses, every
  address is checksummed and appears once, each has a dated, sourced verification.
- A fork test in `packages/chain-evm/src/fork/` reads `eth_getCode` at every token and contract
  at the pinned block, like `bsc-addresses.test.ts`. The fork suite forks BSC today; a second
  chain adds its fork to the suite's global setup in `config/vitest/fork-setup.ts`.
- Venues that trade on the chain run their fork tests on it (`add-venue`).

```sh
pnpm vitest run packages/chains --maxWorkers=2
pnpm test:fork packages/chain-evm/src/fork
pnpm run check:chain-literals
```

`chains` is money-path code: run `review-money-path` and paste its checklist into the pull
request.

## 6. Report

The chain or the addresses added, each with its source and the day it was read, the fork run that
read them, and the ADR when a chain was added.
