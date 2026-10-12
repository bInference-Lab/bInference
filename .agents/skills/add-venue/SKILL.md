---
name: add-venue
description: Adds a trading venue as a plugin under plugins/, from its API client to the contract suites, fork tests and wiring in the composition root. Use when binference should quote or trade through a new DEX, aggregator or launchpad.
---

# Add a venue

A venue is a plugin behind the venue port: it quotes, builds the calls of a trade and decodes them
back. It never signs, never sends and never decides. The engine's venue host checks everything it
builds against the registry and the confirmed terms.

## 1. Before code

- **The client.** Use the venue's official SDK at its latest release when one fits. When it does
  not (it calls `fetch` without a timeout, pulls in a second viem, misses errors), write a thin
  client and record why with `write-adr`, as decision 0105 does.
- **The docs.** Every endpoint, header, limit and error code comes from the venue's own docs. List
  each error the docs name; the client maps every one.
- **The contracts.** Every router, spender and executor the venue's calls touch goes into the
  registry first (`add-chain`), read on chain.
- **The name.** The venue's id is kebab-case and is the plugin's folder name. A new term goes into
  `docs/GLOSSARY.md` first.

## 2. The plugin's shell

Make `plugins/<venue>/` with the files every plugin has; copy their shape from
`plugins/kyberswap/`:

- `package.json` (`@binference/<venue>`, private, the `@binference/source` export condition, a
  `./testing` export), `tsconfig.json`;
- `AGENTS.md` with the venue's rules, `CLAUDE.md` holding the one line `@AGENTS.md`, and
  `README.md`;
- `src/index.ts` exporting the factory, `src/testing.ts` exporting the recorded fixtures.

Add its dependencies with `pnpm add <dep> --filter @binference/<venue>`: a dependency is the
latest release at least 7 days old, and its pull request says why a Node built-in does not do the
job. Run `pnpm check:package-graph --write`.

## 3. The code

Keep the folders that the existing venues use:

- `src/api/`: the one folder that talks to the venue's API, through the `Http` port with a signal
  and a timeout. Every answer passes a zod schema in a `*.schema.ts` file and leaves the folder as
  the plugin's own types. A key is a `Secret`, never in a URL or a log.
- `src/routes/`: the quote. It refuses a route that trades other tokens or another amount, that
  takes a fee, or that passes a pool hook off the chain's allowlist.
- `src/router/`: the build and the decoder. The build carries the host's recipient, deadline and
  minimum out. A venue whose trade call takes no deadline, such as a launchpad's curve, declares
  `noDeadline` on that chain (decision 0180), and its decoder leaves the deadline out. The decoder reads every term the host checks from the calldata; a call in any other
  shape is `unknown_call`, never a guess.
- A launchpad uses `defineLaunchpad` instead and adds `src/curve/`: the curve read from its own
  contracts, which passes `curveReaderContract`. A tax its contract takes on the curve goes in the
  quote's `taxBps` (decision 0181).
- `src/<venue>-venue.ts`: `defineVenue` with the id and, per chain, the registry contract names,
  the calls the venue makes (contract and ABI) and the spenders it approves. The Privy ceiling
  allows only declared calls and spenders, so declare exactly what the venue calls.
- Errors are `BinferenceError` with codes under the venue's id (`<venue>.bad_options`).

## 4. Tests

- Unit tests on answers recorded from the live API, saved in `src/testing/` with the day they
  were recorded. No network.
- The venue's own test runs the plugin SDK's contract suites (`quoterContract`,
  `txBuilderContract`, `txDecoderContract` from `@binference/plugin-sdk/testing`).
- `src/fork/<venue>-swap.test.ts` buys and sells through the live API on the pinned BSC fork, and
  checks the wallet's balances after each trade. A venue that needs a key reads it from
  `BINFERENCE_<VENUE>_*` variables in its fork test alone and runs with `describe.runIf` when
  they are set, as the okx plugin does.
- `packages/cli/src/compose/<venue>-venue.test.ts` runs the venue through the venue host's checks.

```sh
pnpm vitest run plugins/<venue> packages/cli/src/compose/<venue>-venue.test.ts --maxWorkers=2
pnpm test:fork plugins/<venue>/src/fork
```

## 5. Wire it

- Add the plugin to `packages/cli/package.json` and create it in
  `packages/cli/src/compose/read-venues.ts`. A venue that needs a key is created only when the
  owner set `venues.keys.<venue>`.
- A core venue joins `coreVenues` in `packages/cli/src/init/ceiling-request.ts`, so a new install's
  ceiling holds its calls.
- A new config key gets a `.describe()` text; run `pnpm check:config-schema --write`.
- Words a person reads (the venue's name in a card, its refusals) are messages in English and
  Chinese.
- The release notes label the venue `experimental` until it has run on the fork suite and with
  real trades.

`chains` and the venue host are money-path code: run `review-money-path` when either changes.

## 6. Report

The venue, its client choice (SDK or ADR), the contracts it declares, the recorded answers'
date, the fork run and the commands you ran.
