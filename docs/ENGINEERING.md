# binference: engineering rules

Every engineer and every AI coding agent on binference follows this file. It turns the architecture
in [ARCHITECTURE.md](ARCHITECTURE.md) and decisions [0022](DECISIONS.md#d0022) to
[0042](DECISIONS.md#d0042) into rules. The root `AGENTS.md` and one `AGENTS.md` per package carry
them in short form (section 22).

Two kinds of entries:

- **Rule**: CI fails or review blocks. Each rule names its enforcer: an Oxlint rule, a rule of
  binference's own Oxlint JS plugin (`guards/*`, section 18), a compiler flag, a pnpm, commitlint or
  GitHub setting, a check script (`check:*`), a test, or a named review step (the skills of section
  20: `review-diff`, `clean-diff`, `shape-commit`, `review-money-path`, `write-adr`, `release`).
  Oxlint rules carry their plugin prefix, as the config writes them. Every rule was mapped to its
  enforcer before the first package was written. A check script named here that does not exist yet
  lands with the first code it checks.
- **Guideline**: the default. A reviewer may accept a different choice when the PR states why.

<a id="section-1"></a>

## 1. Principles

1. **The engine is the trust boundary.** Keys, confirmations, limits and the ledger live in the
   engine and the signer. Every other part reads and proposes ([rule 2](ARCHITECTURE.md#rule-2)).
2. **One owner per responsibility.** One module decides and writes each piece of state; everything
   else calls it. Two writers of one table, or two copies of one check, is a bug.
3. **Small core, capable plugins.** A new venue, chain, model provider, data source or chat app is
   an adapter behind an existing port. It never becomes an `if` in the core.
4. **Agnostic at every edge** (decisions [0022](DECISIONS.md#d0022), [0024](DECISIONS.md#d0024)).
   Core code never names a chain, an operating system, a model provider, a database or a chat app.
   Adapters do, and the composition root picks them.
5. **Fail closed on money, fail soft on telemetry.** Doubt in policy, risk, simulation or signing
   rejects the action. A failing log or metric never blocks a trade.
6. **Complete cutover.** A change moves every caller and deletes the old path with its exports,
   tests and docs in the same PR. A kept old path needs a named contract and a removal date.
7. **Less code wins.** No speculative helpers, no one-use wrappers, no abstraction without a second
   user (section 4.4).
8. **Every action has a visible outcome.** An error tells the reader the next step.
9. **No random choices.** When the architecture, the specs and this file are silent, follow the
   nearest rule here. If the question is still open, write a short decision record and get the
   maintainers' yes before coding ([ARCHITECTURE.md section 28](ARCHITECTURE.md#section-28)).

The principles are not checked on their own: each binds through the rules below and the review steps
of section 20.

<a id="section-2"></a>

## 2. Architecture

<a id="section-2-1"></a>

### 2.1 Package graph

Each package may import only the packages in its row. The table is data in
`config/package-graph.json`; `check:package-graph` checks each `package.json` against it and
generates Oxlint's per-package `eslint/no-restricted-imports` blocklists from it. `import/no-cycle`
forbids cycles between packages and between files.

| Package         | Holds                                                                                                                                                                                                | May import                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `core`          | `Result`, `BinferenceError`, branded ids, amount math, retry, and the `Clock`, `Random`, `Logger` and `Http` ports                                                                                   | zod                                                                                                  |
| `chain`         | The chain-neutral model: CAIP ids, `Amount`, and the `ChainFamily`, `SigningScheme`, `ChainRegistry` and `Signer` ports                                                                              | `core`                                                                                               |
| `chain-evm`     | The EVM family: viem clients, RPC failover, nonces, fees, `eth_simulateV1`, private relays, decoding, EVM signing scheme                                                                             | `core`, `chain`, viem, `@noble/curves`; `chains` in its fork tests only                              |
| `chains`        | Data only: one file per chain (`bsc.ts`), its tokens, contracts, RPCs, relays and explorers                                                                                                          | `core`, `chain`                                                                                      |
| `platform`      | The OS layer (section 2.5)                                                                                                                                                                           | `core`, execa, `@napi-rs/keyring`                                                                    |
| `store`         | Store ports' SQLite adapters, migrations, the Kysely dialect                                                                                                                                         | `core`, `chain`, `engine` (its store ports), kysely                                                  |
| `protocol`      | zod schemas for frames, methods, events and their scopes                                                                                                                                             | `core`, `chain`                                                                                      |
| `i18n`          | en and zh messages, glossary, formatters for amounts and dates                                                                                                                                       | `core`, `chain`                                                                                      |
| `engine`        | Domain and use cases: intents, policy, risk, confirmations, wallet queues, orders, watchers, ledger, paper mode                                                                                      | `core`, `chain`, `protocol`, `i18n`                                                                  |
| `signer`        | The signer process: the agent key, the hard rules, Privy authorization signatures (spec 5)                                                                                                           | `core`, `chain`                                                                                      |
| `custody-privy` | The `privy-owner` custody adapter: key quorums, the ceiling builder, wallets, signing calls through Privy's API (spec 5, [decision 0085](DECISIONS.md#d0085))                                        | `core`, `chain`, `chain-evm`, zod                                                                    |
| `server`        | The protocol server: `node:http` + `ws`, auth, scopes, static console and Mini App files; a separate listener for the public webhook path ([ARCHITECTURE.md section 25](ARCHITECTURE.md#section-25)) | `core`, `protocol`, `engine`, ws                                                                     |
| `telegram`      | The Telegram channel adapter                                                                                                                                                                         | `core`, `protocol`, `i18n`, `engine` ports, grammy                                                   |
| `client`        | Typed protocol client for Node and browsers                                                                                                                                                          | `core`, `protocol`                                                                                   |
| `runtime`       | The agent runtime: loop, sessions, context, skills, memory, model providers                                                                                                                          | `core`, `protocol`, `client`, `i18n`, `store`, `openai`, `@anthropic-ai/sdk`, `partial-json`, `yaml` |
| `tui`           | Terminal chat                                                                                                                                                                                        | `client`, `protocol`, `i18n`, a terminal UI library                                                  |
| `console`       | The React console                                                                                                                                                                                    | `client`, `protocol`, `i18n`                                                                         |
| `mcp`           | MCP server (read and propose tools)                                                                                                                                                                  | `client`, `protocol`                                                                                 |
| `plugin-sdk`    | What plugins import: manifest types, `defineVenue`, `defineData`, `defineTool`, family helpers                                                                                                       | `core`, `chain`, `protocol`, `chain-evm` (helpers re-exported)                                       |
| `plugins/*`     | Venues and data sources                                                                                                                                                                              | `plugin-sdk` and their declared dependencies                                                         |
| `cli`           | The `binference` command and the composition root                                                                                                                                                    | everything                                                                                           |

The transport lives in `server`, so `engine` holds no I/O at all, and terminal chat has its own
package, `tui` ([decision 0050](DECISIONS.md#d0050)).

Rules:

- **ARCH-1** A package imports only what its row allows. Enforcer: `check:package-graph` against
  `config/package-graph.json`, the `eslint/no-restricted-imports` blocklists it generates from that
  file, and pnpm's isolated `node_modules` (an undeclared import fails `tsc` (TypeScript 7)). The
  blocklists are generated because an allowlist cannot be written in Oxlint: its regex has no
  look-ahead, and a look-ahead pattern matches nothing without an error.
- **ARCH-2** No import cycles. Enforcer: Oxlint `import/no-cycle`.
- **ARCH-3** Imports go through a package's `exports` map, never into another package's `src/`.
  Enforcer: Oxlint `eslint/no-restricted-imports` (patterns `^@binference/[^/]+/src/` and
  `^(\.\./){2,}`); NodeNext resolution refuses a subpath the `exports` map does not list.
- **ARCH-4** Only `cli` and the signer's entry file read `process.env`, `process.argv`, the config
  file or the clock of the real world; everything else receives typed values. Enforcer: Oxlint
  `node/no-process-env`, `eslint/no-restricted-properties` (`process.argv`),
  `eslint/no-restricted-globals` (`process` in pure packages) and the TS-11 rules; reads of the
  config file: `review-diff`.
- **ARCH-5** `core`, `chain`, `protocol`, `engine` and `i18n` are pure: no `node:fs`, `node:net`,
  `node:child_process`, `node:sqlite`, viem, grammy, kysely, undici or ws. Enforcer: Oxlint
  `eslint/no-restricted-imports` (`paths` for the `node:` modules, `patterns.group` for viem,
  grammy, kysely, undici and ws).

Dependency-cruiser was the first choice for these checks. It supports TypeScript below 7 only, and
under TypeScript 7 it scanned 0 files and reported success (tested 2026-10-06), so binference uses
Oxlint's import rules, with `check:package-graph` for the allowlist a regex cannot express.

<a id="section-2-2"></a>

### 2.2 Inside a package

Folders are by feature, not by layer:

```text
packages/engine/src/
  orders/
    order.ts            types and pure rules
    order-service.ts    use cases, ports only
    ports.ts            OrderStore, PriceSource
    order.test.ts
  index.ts              the public API
```

- **Rule:** a use case receives its ports through its factory ([decision 0026](DECISIONS.md#d0026)):
  `createOrderService({ store, prices, clock })`. No module-level singletons, no service locators,
  no DI container. Enforcer: `guards/no-class` and Oxlint `import/no-mutable-exports` for the
  mechanical part; `review-diff` for the rest.
- **Rule:** the composition root (`cli/src/compose/`) is the only place that builds adapters and
  wires them in. The signer's entry file is the signer's composition root. Enforcer: ARCH-1
  (`check:package-graph`: adapter packages are dependencies of `cli` only) and `review-diff`.
- **Guideline:** a port lives beside its first consumer (`orders/ports.ts`). A port that two
  packages implement moves to the lowest package both depend on.
- **Rule:** only the composition roots know the profile ([rule 19](ARCHITECTURE.md#rule-19)). Code
  in any other package never names a profile or holds one in a variable; it takes a port whose
  adapter the composition root picks. Enforcer: `guards/no-profile-mention`, on for every package
  but `cli`.

<a id="section-2-3"></a>

### 2.3 Registries instead of switches

Venues, chains, chain families, signing schemes, model providers, data sources and channels register
in typed registries that the composition root fills.

```ts
const venue = venues.get(intent.venueId); // Result: unknown ids are an expected failure
```

- **Rule:** core code never branches on a chain, venue, provider or channel id. Enforcer:
  `check:chain-literals` (`switch` or `===` against registry ids in pure packages) and
  `review-diff`.
- **Rule:** every port has one contract test suite, and every adapter passes it (the Liskov rule).
  Enforcer: `check:contract-suites` (every interface in a `ports.ts` has a suite, and every module
  that implements one has a test that calls it).

<a id="section-2-4"></a>

### 2.4 Chains

Decided in decisions [0022](DECISIONS.md#d0022) and [0023](DECISIONS.md#d0023).

- **Ids are CAIP strings, branded and parsed by zod in `chain`:**
  - chain (CAIP-2): `eip155:56`
  - account (CAIP-10): `eip155:56:0x8894E0a0c962CB723c1976a4421c95949bE2D4E3`
  - asset (CAIP-19): `eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955`, and the native
    coin `eip155:56/slip44:714`
- **`Amount`** is `{ asset: AssetRef; base: bigint }`; decimals come from the asset's definition.
  Math lives in `core`, display in `i18n`.
- **`ChainFamily`** is the port a family implements: parse and format accounts, build transfers and
  approvals, estimate fees, simulate, broadcast, watch blocks and logs, decode receipts, and order
  transactions (nonces for EVM).
- **`ChainDefinition`** is data in `chains`, exported with a `ChainDefinition` type annotation
  (TS-7). It holds the id, family, native asset, block time, finality rule, RPCs, relays, explorers,
  tokens and contracts.
- **Venues declare** the chains they serve and their contracts per chain.
- **Wallet queues key on the account:** `wallet:eip155:56:0x…`.
- **Rule:** pure packages contain no chain literal (`eip155:`, `56`, `bsc`) and no hex address.
  Enforcer: `check:chain-literals`.
- **Rule:** every EVM address in `chains` is checksummed, and a fork test reads `eth_getCode` for
  each contract. Enforcer: a unit test (`getAddress(a) === a` over `chains`) and the fork suite.
- **Adding an EVM chain** is a file in `chains`, its venue addresses, and fork tests. **Adding a
  family** (Solana) is a package that implements `ChainFamily` and `SigningScheme` and passes their
  contract suites. Neither touches `engine`.
- v1 enables BSC only ([decision 0023](DECISIONS.md#d0023)).

<a id="section-2-5"></a>

### 2.5 Operating systems

Decided in decisions [0024](DECISIONS.md#d0024) and [0039](DECISIONS.md#d0039).

`platform` hides every OS difference behind ports. Implementations live in `platform/src/posix/`,
which macOS and Linux share, and `platform/src/win32/`; `createPlatform` picks them once at startup
from `process.platform`.

| Port              | macOS                        | Linux                        | Windows                                                            |
| ----------------- | ---------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `Paths`           | `~/.binference`              | `~/.binference`              | `%USERPROFILE%\.binference`                                        |
| `SecretStore`     | Keychain                     | Secret Service (libsecret)   | Credential Manager                                                 |
| `ServiceManager`  | `launchctl` (LaunchAgent)    | `systemctl --user`           | `schtasks` (Task Scheduler)                                        |
| `IpcEndpoint`     | Unix socket in the state dir | Unix socket in the state dir | Named pipe `\\.\pipe\binference-<install id>-<name>`               |
| `FilePermissions` | `0600` files, `0700` folders | `0600` files, `0700` folders | An ACL for the owner, SYSTEM and Administrators, nothing inherited |
| `Shutdown`        | `SIGINT`, `SIGTERM`          | `SIGINT`, `SIGTERM`          | `SIGINT`, `SIGBREAK`, task stop                                    |

`BINFERENCE_HOME` moves the state folder on every OS. The keychain is `@napi-rs/keyring` (prebuilt
binaries, nothing to compile); when no keychain is available, a passphrase prompt is the fallback.
Services use `launchctl`, `systemctl --user` and `schtasks`, all called through execa with argument
arrays.

Rules:

- **OS-1** OS-specific code lives only in `platform`. Enforcer: Oxlint
  `eslint/no-restricted-properties` (`process.platform`) and `eslint/no-restricted-imports`
  (`platform` and `type` from `node:os`), both outside `platform`.
- **OS-2** Paths are built with `node:path`, never by joining strings with `/`. Enforcer: Oxlint
  `node/no-path-concat`, the Windows CI job and `review-diff`.
- **OS-3** Repo scripts are TypeScript (`.mts`) run by Node through tsx; no bash, PowerShell or
  batch files. Enforcer: `check:layout` (no tracked `.sh`, `.ps1`, `.bat` or `.cmd` file; no `bash`
  or `sh -c` in a script).
- **OS-4** `.gitattributes` sets `* text=auto eol=lf`. Enforcer: `check:layout`; oxfmt
  `endOfLine: "lf"`.
- **OS-5** No dependency that compiles native code at install. Prebuilt binaries only. Enforcer:
  pnpm `allowBuilds` (a reviewed list) with `strictDepBuilds: true`; `CODEOWNERS` on
  `pnpm-workspace.yaml`.
- **OS-6** Every CI check runs on Linux, macOS and Windows. Enforcer: the CI matrix; the `master`
  ruleset requires each OS job.

<a id="section-2-6"></a>

### 2.6 Processes and threads

- The engine process supervises two child processes, the signer and the agent runtime
  ([ARCHITECTURE.md section 1](ARCHITECTURE.md#section-1)). They talk over `IpcEndpoint` with
  zod-validated messages.
- **Rule:** database work runs on worker threads; the main thread awaits results. Enforcer:
  `review-diff`, and `check:store` (`node:sqlite` only in worker entries) once the first store
  lands. The one exception is the platform's engine lock, `platform/src/file-lock.ts`: a single
  `node:sqlite` statement on the main thread that takes an OS file lock and reads no rows.
  `check:store` exempts that file.
- **Rule:** every queue, buffer, cache and map has a maximum size and a stated overflow policy (drop
  oldest, refuse or block). Enforcer: `review-diff`.

<a id="section-3"></a>

## 3. TypeScript (always loaded)

- **TS-1** TypeScript 7. `tsconfig` base: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
  `noPropertyAccessFromIndexSignature`, `noUncheckedSideEffectImports`, `verbatimModuleSyntax`,
  `isolatedDeclarations`, `erasableSyntaxOnly`, `module` and `moduleResolution` `NodeNext`, target
  ES2023. The console uses `Bundler` resolution. Enforcer: `tsc` (TypeScript 7); `check:tsconfig`
  (every package `tsconfig` extends the base and overrides none of these flags, except the console's
  resolution).
- **TS-2** ESM only, Node `>=26.1` ([decision 0092](DECISIONS.md#d0092): Node 24 cannot sandbox
  plugins). Relative imports end in `.js`. Enforcer: `engines` with pnpm `engineStrict: true` for
  the Node range; `tsc` (TypeScript 7) with NodeNext for ESM and `.js` endings (TS2835); Oxlint
  `import/no-commonjs` and `typescript/no-require-imports`.
- **TS-3** No `any`, no non-null `!`, no `enum`, no `namespace`, no default export, no `@ts-ignore`
  or `@ts-nocheck`. A `@ts-expect-error` carries its reason. Enforcer: Oxlint
  `typescript/no-explicit-any`, `typescript/no-non-null-assertion`, `typescript/no-namespace`,
  `import/no-default-export` and `typescript/ban-ts-comment` (`ts-expect-error` set to
  `allow-with-description`); `erasableSyntaxOnly` for `enum` (TS1294), since Oxlint has no rule for
  it.
- **TS-4** `as` appears only in tests and in named assertion helpers (`assertNever`,
  `assertAccountRef`). Enforcer: Oxlint `typescript/consistent-type-assertions`
  (`assertionStyle: "never"`), off for `*.test.ts` and `assert-*.ts` files; `as const` stays legal.
- **TS-5** `unknown` is written only in boundary files (`*.schema.ts` and each adapter's parse step)
  and in a `.catch()` callback's parameter, and is parsed by zod or narrowed at once (section 9).
  Enforcer: Oxlint `typescript/no-restricted-types` (`unknown`) outside boundary files, with
  `.catch()` parameters exempt because `use-unknown-in-catch-callback-variable` requires them; and
  the SCH-1 rules.
- **TS-6** Branded types for ids, accounts, assets and amounts. Money is `bigint` in base units,
  never `number`. USD is `bigint` micro-dollars. Rates and slippage are integer basis points.
  Enforcer: the branded `Amount` type; in money packages Oxlint `eslint/no-restricted-globals`
  (`Number`, `parseFloat`, `parseInt`), `eslint/no-restricted-properties` (`toFixed`,
  `Number.parseFloat`) and `eslint/no-implicit-coercion`.
- **TS-7** `interface` for object shapes and ports, `type` for unions and aliases, `satisfies` for
  data definitions inside a file. `satisfies` cannot be used on an exported value under
  `isolatedDeclarations`, so exported data carries a type annotation instead
  (`export const bsc: ChainDefinition = ...`). Enforcer: Oxlint
  `typescript/consistent-type-definitions` (`"interface"`); `isolatedDeclarations` for exported
  data; `satisfies` for other data: `review-diff`.
- **TS-8** Every `switch` on a union is exhaustive. Enforcer: Oxlint
  `typescript/switch-exhaustiveness-check` with `considerDefaultExhaustiveForUnions: false`, so a
  `default` cannot hide a missing case.
- **TS-9** Data is `readonly`. Never mutate an input. Enforcer: Oxlint `eslint/no-param-reassign`
  (`props: true`) for assignments; in pure packages `typescript/prefer-readonly-parameter-types`, so
  `tsc` (TypeScript 7) also refuses a mutating call such as `order.tags.push(x)` on a parameter;
  elsewhere, `review-diff` for mutating calls.
- **TS-10** No floating promises. Every async function that does I/O takes `signal: AbortSignal` in
  its options and applies a timeout (`AbortSignal.timeout`, combined with `AbortSignal.any`).
  Enforcer: Oxlint `typescript/no-floating-promises` and `typescript/no-misused-promises`; `signal`
  is required in port option types; `guards/require-abort-signal` on raw `fetch` and execa calls in
  adapters; `review-diff` for the timeout.
- **TS-11** Pure packages read time and randomness only through the `Clock` and `Random` ports.
  Enforcer: Oxlint `eslint/no-restricted-properties` (`Date.now`, `Math.random`,
  `crypto.randomUUID`, `crypto.getRandomValues`, `performance.now`) and
  `eslint/no-restricted-imports` (the random functions of `node:crypto`); `guards/no-argless-date`
  for `new Date()` without arguments, which no Oxlint rule can match.
- **TS-12** Every exported function and method declares its return type. Enforcer: Oxlint
  `typescript/explicit-module-boundary-types`. `isolatedDeclarations` alone lets a trivially
  inferred return such as `return 1` through.

<a id="section-4"></a>

## 4. Clean code and SOLID

<a id="section-4-1"></a>

### 4.1 Size

Decided in [decision 0028](DECISIONS.md#d0028).

| Limit                 | Value                             | Enforcer                                                                                   |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| Lines per file        | 300 code lines (600 for tests)    | Oxlint `eslint/max-lines` with `skipBlankLines` and `skipComments`; 600 in a test override |
| Lines per function    | 50                                | Oxlint `eslint/max-lines-per-function`                                                     |
| Cyclomatic complexity | 10                                | Oxlint `eslint/complexity`                                                                 |
| Nesting depth         | 3                                 | Oxlint `eslint/max-depth`                                                                  |
| Parameters            | 3; more become one options object | Oxlint `eslint/max-params`                                                                 |

Generated files are exempt. A baseline file of exceptions exists, starts empty and may only shrink.
Enforcer: `ignorePatterns` for generated paths in the Oxlint config; `check:suppressions` for the
baseline (section 18).

<a id="section-4-2"></a>

### 4.2 Functions and files

- **Rule:** one concept per file, named after its main export (`order-service.ts` exports
  `createOrderService`). No `utils.ts`, `helpers.ts`, `common.ts`, `misc.ts` or `shared.ts`.
  Enforcer: `check:layout` (the banned names; a file exports a binding named after it); one concept
  per file: `review-diff`.
- **Rule:** no barrel files except a package's `src/index.ts` and its declared subpath entries.
  Enforcer: Oxlint `oxc/no-barrel-file` (`threshold: 0`, files of `export *`) and
  `guards/no-reexport-file` (files of named re-exports), both off for `exports` entries.
- **Rule:** no boolean flag parameters; split the function or pass a named option. Enforcer:
  `guards/no-boolean-param`.
- **Rule:** no nested ternaries, no `else` after `return`, `const` by default. Enforcer: Oxlint
  `eslint/no-nested-ternary`, `eslint/no-else-return`, `eslint/prefer-const`.
- **Guideline:** return early; keep the happy path unindented.
- **Guideline:** a function either decides or does I/O. A use case reads through ports, calls a pure
  function to decide, then writes through ports.

<a id="section-4-3"></a>

### 4.3 SOLID, mapped to binference

| Principle             | In binference                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Single responsibility | One owner per responsibility (principle 2); the size limits in 4.1                              |
| Open/closed           | New venues, chains, providers and channels plug into registries (2.3); the core stays unchanged |
| Liskov substitution   | One contract test suite per port; every adapter passes it                                       |
| Interface segregation | Small ports: `Quoter`, `TxBuilder`, `TxDecoder`, `PositionReader`, not one wide `Venue`         |
| Dependency inversion  | Domain code depends on ports; adapters are wired in the composition root                        |

<a id="section-4-4"></a>

### 4.4 No duplication, no speculation

- **Rule:** jscpd fails CI on any clone of 8 lines or more outside tests. Enforcer: `dup:check`
  (`--min-lines 8`, tests ignored).
- **Rule:** knip fails CI on unused files, exports and dependencies. Enforcer: `deadcode`.
- **Rule:** the second copy of a piece of logic is extracted into the lowest package that both users
  depend on. A third copy is a review blocker. Enforcer: jscpd (`dup:check`) and `review-diff`.
- **Rule:** a new port, interface or abstraction needs a second implementation or a test fake that
  uses it. Enforcer: `review-diff`.
- **Rule:** no one-use wrappers, naming-only wrappers or duplicate guards. Enforcer: `clean-diff`
  and `review-diff`.
- **Guideline:** before writing a helper, search `core`, `chain` and `plugin-sdk` for it.

<a id="section-5"></a>

## 5. Naming

- Files and folders: kebab-case (`wallet-queue.ts`). Enforcer: Oxlint `unicorn/filename-case`
  (`kebabCase`); folders: `check:layout`.
- Types and interfaces: PascalCase, no `I` prefix (`Signer`, not `ISigner`). Enforcer:
  `guards/no-interface-prefix` and `guards/type-pascal-case` (Oxlint's `eslint/id-match` refuses a
  look-ahead pattern, so it cannot single out the prefix).
- Functions: camelCase verbs (`quoteSwap`, `createPolicy`). Factories start with `create`. Enforcer:
  Oxlint `eslint/id-match` (`^[a-zA-Z][a-zA-Z0-9]*$`, no underscores); verbs and the `create`
  prefix: `review-diff`.
- Booleans: `is`, `has`, `can`, `should` (`isFrozen`). Enforcer: `review-diff` (the rule needs
  types, and Oxlint has no naming-convention rule).
- Units in names: `timeoutMs`, `slippageBps`, `amountBase`, `usdMicros`, `blockNumber`. Enforcer:
  `review-diff` and `review-money-path`.
- Constants: camelCase like other bindings; no SCREAMING_CASE. Enforcer: Oxlint `eslint/id-match`,
  as for functions.
- Abbreviations: only `id`, `url`, `rpc`, `tx`, `abi`, `usd`; everything else spelled out. Enforcer:
  `review-diff`.
- American English (`initialize`, `color`). Enforcer: `review-diff`.
- Product names: **binference** (product), `binference` (CLI, package, config), **plugins**
  (user-facing integrations). Enforcer: `check:style` (a product name in the wrong case).

<a id="section-6"></a>

## 6. Comments and docs

Decided in [decision 0027](DECISIONS.md#d0027).

- **Rule:** every export in a package's public API has a TSDoc block: one or two sentences on what
  it does and what a caller must know. Enforcer: `check:tsdoc` over every export reachable from each
  package's `index.ts` and subpath entries (Oxlint has no `jsdoc/require-jsdoc`).
- **Rule:** a `//` comment states a non-obvious constraint: ownership, lifecycle, ordering, cleanup,
  platform or dependency. It never explains syntax, narrates the next line, records history or names
  the plan. Enforcer: review and the `clean-diff` skill.

  ```ts
  // The raw transaction is stored before broadcast: recovery matches by hash and nonce.
  await store.saveRaw(intentId, raw);
  ```

- **Rule:** no `TODO`, `FIXME` or `XXX`; open an issue instead. Enforcer: Oxlint
  `eslint/no-warning-comments`.
- **Rule:** no commented-out code. Enforcer: review and the `clean-diff` skill; in tests, Oxlint
  `vitest/no-commented-out-tests`.
- **Rule:** each package has a `README.md` with its purpose, its public API and one example.
  Enforcer: `check:layout` (the three headings and a code block).
- **Rule:** each load-bearing decision has a decision record in `docs/adr/` (section 23). Enforcer:
  `review-diff` and `write-adr`.

<a id="section-7"></a>

## 7. Errors, retries and timeouts

Decided in [decision 0029](DECISIONS.md#d0029).

- **Rule:** expected outcomes return `Result` from `core`:
  `{ ok: true; value } | { ok: false; error }`. The error side of an expected outcome is a
  string-literal union (`"daily_cap" | "max_tax" | "frozen"`). Enforcer: `review-diff`, over the
  `Result` type in `core`.
- **Rule:** faults throw `BinferenceError`, the one error class, with a dotted `code`
  (`rpc.timeout`), a `cause` and redacted `details`. Classes exist only for errors: no other class
  is written; everything else is a factory function (section 2.2). Enforcer: the JS plugin rule
  `guards/no-class` (no class outside `core`'s error file); Oxlint `typescript/only-throw-error`
  (only `Error` objects are thrown) and `unicorn/throw-new-error`; a test of the code format.
  `only-throw-error` accepts any `Error`, so a built-in `Error` thrown directly is left to
  `review-diff`.
- **Rule:** `catch` binds `unknown` and narrows it. An empty `catch` is banned. Enforcer: `strict`,
  whose `useUnknownInCatchVariables` types `catch (e)` as `unknown` (TS18046 on use before
  narrowing); Oxlint `typescript/use-unknown-in-catch-callback-variable` for `.catch()` callbacks;
  `eslint/no-empty`.
- **Rule:** at a boundary, errors map to protocol error codes; people see i18n text chosen by the
  code, never `error.message`. Enforcer: Oxlint `eslint/no-restricted-properties` (`message`) in
  `telegram`, `console`, `tui` and the CLI's output; `review-diff`.
- **Rule:** retries use the `retry` module in `core`: transient faults only, capped exponential
  backoff with jitter, a maximum attempt count and a total time budget. Nothing retries after a side
  effect ([ARCHITECTURE.md sections 4 and 7](ARCHITECTURE.md#section-4)). Enforcer:
  `review-money-path`.
- **Rule:** every network call, child process and IPC call has a timeout. Enforcer: TS-10.

<a id="section-8"></a>

## 8. Logging and observability

Decided in [decision 0040](DECISIONS.md#d0040).

- **Rule:** logs go through the `Logger` port in `core`, backed by tslog, with one child logger per
  subsystem (`engine.policy`, `chain-evm.relay`). Enforcer: Oxlint `eslint/no-console`;
  `eslint/no-restricted-imports` (`tslog` outside the logger adapter).
- **Rule:** log records carry ids, not content: `agentId`, `intentId`, `orderId`, `traceId`,
  `chain`. Prompts, model output, tool results and chat text are never logged. Enforcer: log fields
  typed to ids; `review-diff`.
- **Rule:** redaction masks private keys (`0x` + 64 hex), BIP-39 phrases, bot tokens, `binf_` keys
  and every key named in config as secret. A test feeds each pattern through the logger.
- **Guideline:** levels: `error` needs a person, `warn` is a recovered problem, `info` is a state
  change, `debug` is for development.
- Files go to `~/.binference/logs/`, rotated by size and age. OpenTelemetry is an optional adapter.

<a id="section-9"></a>

## 9. Schemas and validation

Decided in [decision 0041](DECISIONS.md#d0041).

binference uses zod 4 for every schema: protocol, tool parameters, config, external API responses,
IPC messages, Telegram callback data and JSON columns. One schema language, because:

- one schema per shape removes a second definition of every protocol type;
- zod's transforms and brands express money types (string to `bigint`, checksummed address)
  directly;
- the MCP SDK and the OpenAI and Anthropic SDK helpers take zod schemas;
- zod 4 emits JSON Schema (`z.toJSONSchema`) for the model, the console's forms and clients in other
  languages.

Rules:

- **SCH-1** Every boundary input is parsed by zod before use. Enforcer: Oxlint
  `typescript/no-unsafe-assignment`, `typescript/no-unsafe-return`,
  `typescript/no-unsafe-member-access`, `typescript/no-unsafe-argument` and
  `typescript/no-unsafe-call`, with the TS-4 and TS-5 rules.
- **SCH-2** Each exported shape has one declared type and one schema annotated with it, side by
  side ([decision 0098](DECISIONS.md#d0098)); no `z.infer` in an exported position, and a type
  with no schema for a shape that crosses a boundary is banned. Enforcer: `isolatedDeclarations`
  (an unannotated exported schema fails to compile), a fixture test per exported shape, and
  `review-diff`.
- **SCH-3** Each shape has one schema, in its owning package; other packages import it. Enforcer:
  jscpd (`dup:check`) and `review-diff`.
- **SCH-4** Every tool and protocol schema converts with
  `z.toJSONSchema(schema, { unrepresentable: "throw" })`. Enforcer: a test over all of them.
- **SCH-5** The console imports `zod/mini` to keep its bundle small. Enforcer: Oxlint
  `eslint/no-restricted-imports` (`zod`) in `console`.
- **SCH-6** External providers keep one folder each, validate with zod, and map responses into
  binference types before they leave the folder
  ([ARCHITECTURE.md section 2](ARCHITECTURE.md#section-2)). Enforcer: Oxlint
  `eslint/no-restricted-globals` (`fetch`) outside the `Http` adapter; the SCH-1 rules;
  `review-diff`.

<a id="section-10"></a>

## 10. Storage

Decided in [decision 0031](DECISIONS.md#d0031).

- **Rule:** `node:sqlite` with Kysely through a synchronous dialect (`store/src/dialect/`). Queries
  use Kysely; raw SQL appears only in migrations and schema bootstrap. Enforcer: `check:store`.
- **Rule:** write transactions are synchronous, with no `await` inside: plan the async work first,
  reread the authoritative rows, then write and commit
  ([ARCHITECTURE.md section 17](ARCHITECTURE.md#section-17)). Enforcer: `check:store` (the callback
  is not `async` and holds no `await` and no Promise).
- **Rule:** each store port has a contract test suite; the SQLite adapter passes it, and a Postgres
  adapter will pass the same suite when the cloud plan builds one. Enforcer: the contract suites and
  `check:contract-suites`.
- **Rule:** migrations are numbered and forward-only, never edited after a release, and run by
  `binference check --fix` after a backup. Enforcer: `check:store` (`NNNN_name.ts` in order, no
  `down`, released files hash-locked); a test that `check --fix` backs up first.
- **Rule:** amounts are stored as decimal strings of base units (SQLite integers stop at 64 bits);
  timestamps are epoch milliseconds in UTC. Enforcer: the store contract test (a 2^64 + 1 round
  trip); the `add-migration` skill for new columns.
- **Rule:** the ledger is append-only and hash-chained; no `UPDATE` or `DELETE` touches it.
  Enforcer: `check:store` (no `updateTable` or `deleteFrom` on the ledger) and the chain-verify
  test.

<a id="section-11"></a>

## 11. Configuration

Decided in [decision 0032](DECISIONS.md#d0032).

- **Rule:** `~/.binference/config.json5` is JSON5, parsed by a strict zod schema that rejects
  unknown keys. Startup stops with a message naming the key and the fix. Enforcer: the config schema
  test.
- **Rule:** layers, lowest first: defaults, the file, `BINFERENCE_*` environment variables, CLI
  flags. Per-agent values sit under `agents.<id>`. Enforcer: the config loader test.
- **Rule:** secrets are references, never values. The secret sources are `{ fromEnv }`,
  `{ fromFile }`, `{ fromCommand }` (1Password, Vault, pass) and `{ fromKeychain }`. A plaintext
  secret fails validation, because these secrets open wallets, and `binference check --fix` offers
  to move it to the keychain. Enforcer: the config schema test.
- **Rule:** every key has a `.describe()` text; docs and console forms are generated from the
  schema. Enforcer: a test that every JSON Schema property has a `description`;
  `check:config-schema` (the generated docs and forms are current).
- **Rule:** a change to the config shape ships its config migration (`binference check --fix`). No
  silent aliases. Enforcer: `check:config-schema` (a schema change comes with a new config
  migration).
- **Rule:** a new switch defaults to its safer value. A risky switch is named `dangerously…`.
  Enforcer: a test that every `dangerously*` key defaults to `false`; `review-diff` for which value
  is safer.
- **Guideline:** limits, venues, send level and paper or live mode change live through the protocol.
  Ports, storage and plugins need a restart.

<a id="section-12"></a>

## 12. Money-path code

The rules in [ARCHITECTURE.md](ARCHITECTURE.md#rules) set the product rules. In code:

- **Rule:** amounts stay `bigint` base units end to end. Decimals appear only when parsing what a
  person typed and when `i18n` formats for display. Enforcer: the TS-6 rules and
  `review-money-path`.
- **Rule:** an intent changes state only through the intent state machine module, its one owner. Its
  transition table is tested in full. Enforcer: the full transition-table test; `check:store` (one
  writer of the state column).
- **Rule:** side effects happen only in the wallet queue, and the queue rechecks the confirmation
  record right before it signs. Enforcer: the revoked-confirmation test; Oxlint
  `eslint/no-restricted-imports` (the signer client only in the wallet queue folder);
  `review-money-path`.
- **Rule:** policy and amount math have fast-check property tests. Enforcer: `check:layout` (each
  policy and amount module has a `*.property.test.ts`).
- **Rule:** money fields in tool arguments are decimal strings, parsed with the integer-safe JSON
  parser, never coerced through `number`. Enforcer: a test over every tool schema (money fields use
  the shared decimal-string schema); `review-money-path`.
- **Rule:** a PR touching `engine`, `signer`, `chain`, `chain-evm`, `chains` or `protocol` runs the
  `review-money-path` skill and pastes its checklist into the PR. Enforcer: `check:pr` (the
  checklist is present and ticked when those paths change).

<a id="section-13"></a>

## 13. Security engineering

- **Rule:** no `eval`, `new Function` or `node:vm` outside the plugin sandbox. Enforcer: Oxlint
  `eslint/no-eval`, `eslint/no-new-func`, `typescript/no-implied-eval` and
  `eslint/no-restricted-imports` (`node:vm`).
- **Rule:** child processes run through execa with an argument array and no shell. Enforcer: Oxlint
  `eslint/no-restricted-imports` (`node:child_process`, and execa's `execaCommand`,
  `execaCommandSync` and `$`); an OpenGrep rule for `shell: true`.
- **Rule:** secrets never appear on a command line, in a URL or in a log. Enforcer: the redaction
  test of section 8; OpenGrep rules for secret values in execa arguments and URL templates;
  `review-money-path`.
- **Rule:** a path from a person, the model or a plugin opens only through the safe-path roots in
  `platform/src/safe-paths/`. Enforcer: Oxlint `eslint/no-restricted-imports` (`node:fs` outside
  `platform` and `store`); `review-diff`.
- **Rule:** outbound HTTP goes through the `Http` port (undici, timeouts, proxy support). A URL from
  a person, the model or a plugin passes the SSRF policy in `core/src/url-guard/`. Enforcer: Oxlint
  `eslint/no-restricted-globals` (`fetch`) and `eslint/no-restricted-imports` (`undici`,
  `node:http`, `node:https`) outside the `Http` adapter (`server` keeps `node:http` for its
  listener); the SSRF policy tests.
- **Rule:** pre-commit runs `detect-private-key`, `pnpm audit --audit-level=high`, Oxlint and oxfmt.
  CI adds OpenGrep rules, CodeQL, zizmor and actionlint. Enforcer: `detect-private-key`,
  `pnpm audit --audit-level=high`, OpenGrep, CodeQL, zizmor and actionlint are required CI jobs.
- **Rule:** npm packages publish only from CI, with provenance through trusted publishing; release
  tags are signed; each release ships a CycloneDX SBOM. Enforcer: trusted publishing with publish
  tokens off; the release workflow; the `release` skill.
- **Rule:** plugin publisher signatures are verified with sigstore at install. Enforcer: an install
  test with a bad signature.

<a id="section-14"></a>

## 14. Languages

Decided in [decision 0018](DECISIONS.md#d0018).

- **Rule:** every word the agent's own interface shows (Telegram, console, CLI output) ships in
  English and Simplified Chinese in the same PR, with messages in
  `packages/i18n/messages/{en,zh}/<area>.json`. Enforcer: `check:i18n` (en and zh key parity); text
  written in code: `review-diff`.
- **Rule:** Chinese follows the [Chinese terms](GLOSSARY.md#chinese-terms) in `docs/GLOSSARY.md`; a
  missing term goes into the glossary first. Enforcer: `check:i18n` (glossary pairs).
- **Rule:** ICU arguments for numbers and plurals; no sentence built by joining pieces. Enforcer:
  `check:i18n` (ICU parse, the same arguments in en and zh); `review-diff`.
- Logs, error codes, protocol fields and model-facing tool descriptions stay English. Enforcer:
  `check:style` (CJK text outside zh messages and zh docs; the card spec and the glossary, which
  show the Chinese words, are listed in `config/style/rule-exceptions.txt`).

<a id="section-15"></a>

## 15. Testing

Decided in [decision 0034](DECISIONS.md#d0034).

- **Rule:** Vitest 5, tests beside the code (`*.test.ts`). Enforcer: each Vitest project's
  `include: ["src/**/*.test.ts"]`; `check:layout` (no test file elsewhere).
- **Rule:** hand-written fakes that implement ports; `vi.mock` is banned in pure packages. Enforcer:
  Oxlint `vitest/no-restricted-vi-methods` (`mock`, `doMock`) in pure packages.
- **Rule:** unit tests have no network (the test setup installs a refusing dispatcher), no real
  timers, no sleeps and no polling. Time comes from a fake `Clock`. Enforcer: a setup file with the
  refusing undici dispatcher and `vi.useFakeTimers()`; Oxlint `vitest/no-restricted-vi-methods`
  (`useRealTimers`, `waitFor`, `waitUntil`), `eslint/no-restricted-globals` (`setTimeout`,
  `setInterval`) and `eslint/no-restricted-properties` (`expect.poll`).
- **Rule:** these Vitest lint rules apply: no conditional tests or expects, no focused or disabled
  tests, no identical titles, awaited expects. Enforcer: Oxlint `vitest/no-conditional-tests`,
  `vitest/no-conditional-expect`, `vitest/no-conditional-in-test`, `vitest/no-focused-tests`,
  `vitest/no-disabled-tests`, `vitest/no-identical-title` and `vitest/valid-expect`
  (`alwaysAwait: true`).
- **Rule:** test names are sentences: `rejects a swap above the daily cap`. Enforcer: Oxlint
  `vitest/valid-title` with `mustMatch` as the string `"^[a-z][^.]*[^.]$"` (the object form reported
  nothing when tested); `review-diff`.
- **Rule:** a regression test fails on the original defect before the fix. Enforcer: `review-diff`,
  with the failing run as PR evidence.
- **Rule:** coverage tiers. Enforcer: per-project Vitest `coverage.thresholds`, Stryker
  `thresholds.break: 80`, and the console's Playwright smoke suite.

  | Tier       | Packages                                                       | Bar                                                                                |
  | ---------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
  | Money core | `engine`, `signer`, `chain`, `chain-evm`, `store` money tables | 95% lines and branches; Stryker mutation score 80% on policy and signer hard rules |
  | Others     | every other package                                            | 80% lines and branches                                                             |
  | Console    | `console`                                                      | Playwright smoke tests of each screen                                              |

- **Kinds of test:** unit, contract (one per port), property (fast-check), fork (anvil at pinned
  blocks, every venue action), crash and recovery, Telegram (synthetic channel in CI, live bot
  before releases touching ingress), agent evaluation (`@copilotkit/aimock` and a fork, nightly),
  console smoke.

<a id="section-16"></a>

## 16. Writing and the slop guard

Decided in [decision 0030](DECISIONS.md#d0030).

These rules cover docs, UI messages, comments, commit messages and PR titles:

- No em dashes or en dashes used as punctuation. Enforcer: `check:style`.
- No filler or hype words. The list lives in `config/style/banned-words.txt` and starts with:
  `easy`, `simple`, `simply`, `just`, `seamless`, `robust`, `delve`, `utilize`, `very`, `really`,
  `powerful`, `effortless`, `cutting-edge`, `elevate`, `streamline`. Trading and product terms such
  as "leverage" and "unlock" (the agent key) are not on it. Enforcer: `check:style` with that list.
- No emojis in code, docs or commits. UI messages may use the status icons the card design names,
  listed by message key. Enforcer: `check:style`; the card spec, which shows the icons, is listed in
  `config/style/rule-exceptions.txt`.
- No internal references: plan or task ids, phase names, people's names, `as discussed`. A decision
  is cited by its number in `docs/DECISIONS.md` ("decision 0085"). Enforcer: `check:style` (id
  patterns, phase names, `as discussed`, a list of team names); the rest: `clean-diff`.
- Short sentences in active voice and the present tense. Enforcer: `clean-diff` (no tool judges
  voice or tense).

`pnpm check:style` scans tracked text files, the PR's commit messages and its title; CI fails on a
hit. It skips its own word lists in `config/style/` and the prose words inside Markdown code, which
is why this file writes the banned words as code. The `clean-diff` skill runs on the diff before
`review-diff`.

<a id="section-17"></a>

## 17. Dependencies

Decided in [decision 0033](DECISIONS.md#d0033).

- **Rule:** pnpm `minimumReleaseAge: 10080` (7 days) with `minimumReleaseAgeStrict: true`; `.npmrc`
  `min-release-age=7` for npm; `blockExoticSubdeps: true`; exact versions; the lockfile is
  committed. Enforcer: the pnpm settings; `check:deps-policy` (the settings are present, versions
  are exact); `pnpm install --frozen-lockfile` in CI.
- **Rule:** an exception (a security fix) is listed with its reason and a removal date. Enforcer:
  `check:deps-policy` (each exception has a reason and a removal date not yet passed).
- **Rule:** install scripts stay off; `allowBuilds` lists only reviewed packages, and names the ones
  refused too (`esbuild: false`), or pnpm 12 fails the install. Enforcer: as OS-5.
- **Rule:** a new dependency is the latest release at least 7 days old. Its PR states the job, what
  else was considered, and why a Node built-in does not do it. Enforcer: pnpm `minimumReleaseAge`;
  `check:pr` (a dependency section in the PR body when dependencies change); `review-diff`.
- **Rule:** a package declares every dependency it imports. Enforcer: knip (unlisted dependencies)
  and pnpm's isolated `node_modules`.
- **Rule:** model SDK clients are built only in `runtime/src/providers/`, with every option set
  explicitly: retries 0, logging off, our own `fetch`, base URL and headers from config. Both
  official SDKs otherwise read their own environment variables and retry twice. Enforcer: Oxlint
  `eslint/no-restricted-imports` (`openai` and `@anthropic-ai/sdk` outside
  `runtime/src/providers/`); the options: `review-diff`.
- Renovate opens grouped update PRs weekly.

<a id="section-18"></a>

## 18. Tooling and `pnpm check`

| Gate        | Tool                                                                                                                                                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format      | oxfmt: width 100, double quotes, trailing commas, LF, sorted imports and `package.json`                                                                                                                                                                                                                                |
| Lint        | Oxlint with type-aware rules (tsgolint): the rules named in sections 2 to 15 and the suppression rule below                                                                                                                                                                                                            |
| Lint plugin | `guards`, binference's own Oxlint JS plugin, one file of AST rules loaded through `jsPlugins`: `no-boolean-param`, `no-argless-date`, `no-class`, `no-reexport-file`, `no-interface-prefix`, `type-pascal-case`, `require-abort-signal`                                                                                |
| Types       | `tsc` from the `typescript@7` package, the native compiler; it has no JS API, so tools that need one are configured around it                                                                                                                                                                                          |
| Tests       | Vitest with coverage thresholds                                                                                                                                                                                                                                                                                        |
| Mutation    | Stryker on the money core (PRs touching it, and nightly), through its command runner (its Vitest runner predates Vitest 5) and with `tsconfigFile` pointed at no file (it needs TypeScript's JS API)                                                                                                                   |
| Dead code   | knip                                                                                                                                                                                                                                                                                                                   |
| Duplicates  | jscpd                                                                                                                                                                                                                                                                                                                  |
| Style       | `check:style` (section 16)                                                                                                                                                                                                                                                                                             |
| Languages   | `check:i18n` (section 14)                                                                                                                                                                                                                                                                                              |
| Repo checks | `.mts` scripts in `scripts/`: `check:package-graph`, `check:tsconfig`, `check:layout`, `check:suppressions`, `check:deps-policy`, `check:tsdoc`, `check:adr`, `check:docs`, `check:contract-suites`, `check:chain-literals`, `check:protocol-compat`, `check:config-schema`, `check:store`; `check:pr` runs in CI only |
| Commits     | commitlint on commit messages and the PR title (section 19.1)                                                                                                                                                                                                                                                          |
| Docs        | markdownlint                                                                                                                                                                                                                                                                                                           |
| Security    | OpenGrep, `pnpm audit`                                                                                                                                                                                                                                                                                                 |
| Build       | tsdown (ESM and `.d.ts`), orchestrated and cached by Turborepo                                                                                                                                                                                                                                                         |

`pnpm check` runs every gate. CI runs it on Linux, macOS and Windows. A red `master` is an
emergency.

- **Rule:** a lint suppression names its rule and a reason:
  `// oxlint-disable-next-line <rule> -- <reason>`. Blanket and unused suppressions fail. A
  suppression of a size rule (4.1) exists only for a file in the size baseline, which starts empty
  and may only shrink. Oxlint lets any rule be switched off with a comment and asks for no reason,
  so this rule closes that gap. Enforcer: Oxlint `unicorn/no-abusive-eslint-disable` (blanket) and
  `--report-unused-disable-directives-severity=error` (unused); `check:suppressions` (a rule and a
  reason on every `oxlint-disable` and `@ts-expect-error`, size suppressions only for baseline
  files, the baseline only shrinks against the merge base).

<a id="section-19"></a>

## 19. Git and review

Decided in decisions [0035](DECISIONS.md#d0035) and [0036](DECISIONS.md#d0036).

- `master` is protected and always releasable. Enforcer: the `master` ruleset (PR required, required
  checks, no force push).
- Branches live a few days; unfinished work ships behind a config switch. Enforcer: `review-diff`
  and `shape-commit`.
- Squash merge. The PR title becomes the commit subject on `master` and follows section 19.1.
  Enforcer: the ruleset (squash only, the PR title as the default message); commitlint on the PR
  title.
- One approval per PR. `CODEOWNERS` routes review. Enforcer: the ruleset (one required approval,
  code owner review).
- A PR changes about 400 lines at most, tests and generated files excluded. Enforcer: `check:pr`
  warns above that; `shape-commit` proposes the split.
- The PR body states the problem, the user impact and the evidence. Enforcer: the PR template and
  `check:pr` (the three sections present, none empty).
- The `review-diff` skill runs before a PR is opened.
- No contributor agreement: MIT only. Enforcer: `LICENSE` and `review-diff`.
- Releases are calver `YYYY.M.PATCH` on `stable` and `beta`. The release notes are written from the
  commit subjects on `master`, so every subject must read as a line of release notes. Enforcer: a
  version format check in the release workflow; commitlint keeps the subjects usable.

<a id="section-19-1"></a>

### 19.1 Commit messages

Decided in [decision 0078](DECISIONS.md#d0078).

Conventional Commits with plain, specific descriptions.

- **Subject:** `type(scope): description`, 72 characters at most. GitHub appends `(#123)` on squash
  merge.
  - `type` is one of `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `ci`, `build`, `chore`,
    `revert` (section 19.3 says which).
  - `scope` is one name from section 19.4; it is left out only for a change across the repo.
  - `description` starts lowercase, has no period, and says exactly what changed or what now works,
    in words a teammate would use. For a fix, it names the symptom the user saw, not the code that
    changed.
- **Body,** when needed: a few short plain paragraphs on why, and on anything a reviewer must know.
  Wrapped at 72 characters. No headings, no checklists.
- **Breaking changes:** `!` after the scope (`feat(protocol)!: ...`) and a body paragraph starting
  `Breaking:` that says what breaks and how to move. A breaking config change carries its config
  migration in the same commit (section 11).
- **Reverts:** `revert: <the original subject>`, with a body naming the commit and why.
- **Never in the description or body:** vague or hype words ("improve", "enhance", "update stuff",
  and the section 16 list), emojis, em or en dashes used as punctuation, plan or task ids, issue
  numbers (they go in the PR body as `Closes #N`), "this commit" phrasing, or AI attribution lines
  (`Co-Authored-By` an AI tool, "Generated with"). `Co-authored-by` names people only, for real pair
  work.
- The same rules apply to PR titles; PR descriptions follow section 16.

| Good                                                                  | Not allowed                                        |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| `fix(orders): stop a trailing stop from firing twice after a restart` | `fix: improve order handling`                      |
| `feat(venus): add supply and borrow with a health-factor floor`       | `feat(lending): seamless robust Venus integration` |
| `perf(store): batch position reads for the portfolio card`            | `refactor: misc changes`                           |
| `fix(telegram): show the resolved address under a .bnb name`          | `feat: task T12 .bnb names done`                   |
| `refactor(policy): move cap checks into one rule list`                | `fix(engine,telegram): cards and caps`             |
| `feat(protocol)!: rename intent/list to intent/find`                  | `feat(orders): add DCA and fix nonce gaps`         |

Enforcer: commitlint on every commit message and on the PR title (`check:pr` runs it on the title):

- the subject: `type-enum` (the ten types), `scope-enum` (built from the folders) with the local
  rule `scope-single`, `header-max-length` 72 (a subject on `master` may end in `(#N)` after a
  space; a `revert:` subject shortens the original description to fit, and its body quotes the
  original subject in full), `subject-case` (`lower-case`) and `subject-full-stop`;
- the body: `body-leading-blank` and `body-max-line-length` 72;
- a breaking change: the local rule `breaking-paragraph`, which reads the raw message, because
  commitlint's parser files a `Breaking:` line as a footer; it fails a `!` subject without a
  `Breaking:` paragraph;
- a revert: `revert` in `type-enum`, and a body that contains `This reverts commit`.

`pnpm check:style` checks the words of every message and the PR title: vague and banned words,
emojis, dashes, plan ids, issue numbers, "this commit", AI trailers, and a `Co-authored-by` naming a
tool or a bot address; it also fails a `#` heading or a `- [ ]` line in a body. `shape-commit`,
which writes the subject, owns what no tool can judge: that the description says exactly what
changed, that a fix names the symptom the user saw, the choice of type and scope (sections 19.3 and
19.4), and the plain voice of the words.

<a id="section-19-2"></a>

### 19.2 What one commit holds

A commit on `master` is one squashed PR: one issue or topic, within the size limit below.

- **One reason to exist.** The change can be described in one subject line. If the subject needs
  "and" to join two unrelated changes, it is two commits. Enforcer: `shape-commit`.
- **Complete.** Code, tests, types, TSDoc, messages in English and Chinese, docs pages, the config
  migration and the ADR travel together (section 21). No "tests later" or "docs later" commit.
  Enforcer: `check:tsdoc`, `check:i18n`, `check:config-schema`, `check:docs` and the coverage
  thresholds; `shape-commit`.
- **Green on its own.** Every commit on `master` passes `pnpm check` on the three OSes and can be
  reverted alone without breaking the build. Enforcer: the required checks on every PR; squash
  merge.
- **The cutover is in the same commit.** A change moves every caller and deletes the old path in
  that commit (principle 6). No dead code waiting for a follow-up. Enforcer: knip (`deadcode`);
  `review-diff`.
- **Kept apart, each in its own commit** (enforcer: `shape-commit`):
  - a refactor, move or rename that a feature needs lands first, with no behavior change, so the
    feature commit holds only the feature; its tests pass unchanged;
  - formatting-only changes;
  - dependency updates: one dependency, or one group that must move together, per commit
    (`build(deps): ...`);
  - an unrelated fix found on the way: its own PR, or an issue. A small repair in the lines the
    change already touches stays.
- **Kept together:** a schema migration and the code that needs it; a protocol operation and its
  server, client and MCP mapping when one cannot work without the other; generated files and the
  change that generates them. Enforcer: each generator's `--check` script fails on stale output;
  `shape-commit`.
- **Too big** (over about 400 lines, or more than one reason): split it into a stack of PRs, each
  green and useful on its own: ports and types, then the adapter, then the wiring. Unfinished
  behavior stays behind a config switch until the last PR turns it on. Enforcer: the `check:pr` size
  warning; `shape-commit`.
- **Nothing private.** Stage only the files the change needs and read `git diff --staged` before
  committing. Never commit secrets, `.env` files, keystores, local paths or git-ignored notes.
  Enforcer: GitHub push protection; `detect-private-key` in CI; `check:style` (local paths and links
  into git-ignored folders).

<a id="section-19-3"></a>

### 19.3 Choosing the type

| Type       | When                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| `feat`     | A user or developer can do something new                                         |
| `fix`      | Behavior was wrong and is now right; the subject names what the user saw         |
| `perf`     | Same behavior, measurably faster or lighter; the PR body carries the measurement |
| `refactor` | Same behavior, better structure; the existing tests pass unchanged               |
| `test`     | Tests only                                                                       |
| `docs`     | Documentation only (`docs/`, `apps/docs/`, READMEs, TSDoc-only changes)          |
| `ci`       | GitHub workflows and CI scripts                                                  |
| `build`    | The toolchain, packaging and dependencies (`build(deps): ...`)                   |
| `chore`    | Repo upkeep that is none of the above (`.gitignore`, templates)                  |
| `revert`   | Undoes an earlier commit on `master`; the form is in section 19.1                |

When two types fit, the one the user would notice wins: a fix that needed a refactor is `fix`.
Enforcer: `shape-commit` (commitlint checks only that the type is on the list).

<a id="section-19-4"></a>

### 19.4 Choosing the scope

The scope is the single most specific owner of the change, from one closed list:

- a package folder name: `core`, `chain`, `chain-evm`, `chains`, `platform`, `protocol`, `client`,
  `engine`, `server`, `signer`, `store`, `telegram`, `runtime`, `console`, `tui`, `mcp`,
  `plugin-sdk`, `i18n`, `cli`;
- a plugin folder name: `pancakeswap`, `kyberswap`, `venus`, `flap`, and so on;
- a feature folder of `engine` or `runtime` (section 2.2), such as `orders`, `policy`, `ledger`,
  `intents`; it is preferred to `engine` when the change stays inside it;
- a fixed area: `deps`, `skills` (bundled skills), `dev-skills` (`.agents/skills/`), `docs`,
  `release`.

Rules:

- **One scope, never two.** A change that spans packages takes the scope where its behavior lives: a
  new protocol operation is `protocol`; a card fix seen in Telegram is `telegram`. Enforcer:
  commitlint `scope-enum` and the local rule `scope-single`; which scope, the most specific owner:
  `shape-commit`.
- **No scope** only for changes across the repo (formatting, toolchain, renames everywhere).
  Enforcer: `shape-commit`.
- **The list is generated** from the folders by the commitlint config, so it never drifts. A feature
  folder may not reuse a package's name; the config fails if one does. Enforcer: the config throws
  at load, and a test loads it.

<a id="section-19-5"></a>

### 19.5 Branches, identity and merging

- **Branches:** `<type>/<short-name>` (`fix/trailing-stop-restart`), one task each, in their own
  worktree when sessions run side by side. Commits on a branch follow section 19.1 too; `fixup!`
  commits are fine there, since the squash removes them. Enforcer: `check:pr` (the head branch
  name).
- **Identity:** the author is the real person, with a verified email on GitHub. Commits are signed
  (SSH or GPG) and show as verified; the `master` ruleset requires it.
- **Merging:** squash only, with the PR title as the subject. The merger adds a body only when a
  reviewer must know something, and always for a breaking change. Enforcer: the ruleset (squash
  only); CI on `master` runs commitlint on the merged commit, so a breaking change without its
  `Breaking:` paragraph fails there.
- **Secrets:** GitHub secret scanning with push protection is on; a blocked push is fixed by
  removing the secret, never by bypassing. Enforcer: push protection; a bypass event is reviewed in
  `review-diff`.

<a id="section-20"></a>

## 20. AI coding agents

Decided in decisions [0037](DECISIONS.md#d0037) and [0079](DECISIONS.md#d0079).

- **Root `AGENTS.md`**, always loaded, under 200 lines: sections 1, 3, 4 and 16 in short form, the
  commands, and links to each package's `AGENTS.md`. This is how the TypeScript rules load in every
  session: skills load on demand, `AGENTS.md` loads always. Enforcer: `check:layout` (under 200
  lines, every link resolves); the content: `review-diff`.
- **One `AGENTS.md` per package**, holding that package's rules (for `signer`: the hard rules and
  the review checklist). Claude Code, Codex and Cursor read it when they open a file in that folder.
  Enforcer: `check:layout`.
- **A one-line `CLAUDE.md` beside every `AGENTS.md`** ([decision 0079](DECISIONS.md#d0079)). It
  holds only `@AGENTS.md`, so Claude Code loads the same rules. Without it, the root `CLAUDE.md`
  would stop Claude Code from reading the package `AGENTS.md` files on its own; with it, each
  package's `CLAUDE.md` loads when Claude Code opens a file there. The root `CLAUDE.md` adds the few
  Claude-only notes below its import. Enforcer: `check:layout` (each `CLAUDE.md` is exactly
  `@AGENTS.md`; the root one may add lines).
- **`CLAUDE.local.md`** is git-ignored: notes for one person's sessions stay on their machine.
  Enforcer: `check:layout` (the file is git-ignored).
- **Skills** live in `.agents/skills/` (the Agent Skills location); `pnpm setup` links
  `.claude/skills` to that folder, as a junction on Windows. First set: `clean-diff`, `review-diff`,
  `shape-commit` (checks the staged diff against section 19.2, proposes a split and writes the
  subject), `add-chain`, `add-venue`, `add-provider`, `add-migration`, `add-message`,
  `review-money-path`, `write-adr`, `release`. Enforcer: a `pnpm setup` test on the three OSes;
  `check:layout` (each listed skill has its `SKILL.md`).
- **Hook:** `.claude/settings.json` runs Oxlint, oxfmt and the style guard on each file an agent
  edits, and shows the result to the agent. Enforcer: `check:layout` (the hook entries are present).
- Agent output passes the same gates as human code. CI is the enforcer.

<a id="section-21"></a>

## 21. Definition of done

A change is done when:

1. its behavior is tested at the cheapest layer that proves it;
2. its public exports carry TSDoc;
3. every new user-facing word exists in English and Chinese;
4. a user-facing change has its docs page in both languages;
5. a config change has its config migration (`binference check --fix`);
6. a load-bearing decision has its ADR;
7. `pnpm check` is green on Linux, macOS and Windows;
8. the old path it replaces is gone (principle 6).

Enforcers, by item: (1) the coverage thresholds and `review-diff`; (2) `check:tsdoc`; (3)
`check:i18n`; (4) `check:docs` (every English page has a Chinese twin in Starlight's `zh-cn/` folder), and `review-diff` for
whether the page exists; (5) `check:config-schema`; (6) `write-adr` and `review-diff`; (7) the
required checks; (8) knip (`deadcode`) and `review-diff`.

<a id="section-22"></a>

## 22. Where these rules live

This file holds every rule. Other files carry parts of it where a reader needs them, and names come
from [GLOSSARY.md](GLOSSARY.md).

| Sections                   | Also carried by                                               |
| -------------------------- | ------------------------------------------------------------- |
| Sections 1, 3, 4, 16, 21   | Root `AGENTS.md` (short form)                                 |
| Sections 2.4, 2.5, 6 to 15 | `packages/<name>/AGENTS.md`, for the package each one governs |
| Section 17                 | `pnpm-workspace.yaml`, `.npmrc`, `CONTRIBUTING.md`            |
| Sections 18, 19            | `CONTRIBUTING.md`, CI workflows, the PR template              |
| Section 24                 | `docs/specs/` and the root `AGENTS.md` (short form)           |

Enforcer: `review-diff` (each file in the table exists and carries its sections).

<a id="section-23"></a>

## 23. Decision records

- Decisions 0001 to 0097 were made before the repository existed. They are recorded as the log in
  [DECISIONS.md](DECISIONS.md), one row each. Enforcer: `check:adr` (the rows run from 0001 to 0097
  in order).
- Every later decision is a record file `docs/adr/NNNN-title.md`, numbered from 0098, with four
  headings: Context, Decision, Consequences and Alternatives. The `write-adr` skill writes it.
  Enforcer: `check:adr` (numbering with no gap or repeat, the four headings).
- `docs/DECISIONS.md` lists every record file, and every number appears there once. Enforcer:
  `check:adr`.
- A decision changes only through a new one that supersedes or amends it. Enforcer: `check:adr`
  with `docs/decisions.lock.json`, which holds the hash of every accepted row and record without
  its status. Only the status may change, and only to "Superseded by NNNN" or "Amended by NNNN".
- When a record is accepted, `pnpm check:adr --write` adds it to the lock. It never changes an
  existing entry, and an entry that differs from the one at the merge base fails the check.

<a id="section-24"></a>

## 24. Conventions and stacks

Decided in decisions [0072](DECISIONS.md#d0072) and [0073](DECISIONS.md#d0073).

These close the choices an engineer would otherwise make alone. Each is a rule.

<a id="section-24-1"></a>

### 24.1 Wire format (the protocol)

- JSON frames. Amounts are decimal strings of base units (JSON has no `bigint`). Times are epoch
  milliseconds in UTC. Enforcer: the protocol schema test (amount and time fields use the shared
  schemas).
- Ids are UUIDv7 strings with a type prefix: `int_` intent, `ord_` order, `cnf_` confirmation, `tx_`
  transaction, `agt_` agent, `wal_` wallet, `whr_` webhook rule. Enforcer: the id schema property
  test.
- Errors are `{ code, message, retryable, details }`; `code` is the dotted code of section 7.
  Enforcer: the protocol error schema test.
- Lists page with an opaque cursor. Idempotency keys are kept 24 hours. Enforcer: engine tests with
  a fake `Clock`.
- One protocol version number. Changes inside a version are additive only; a removal or a meaning
  change bumps the version, and the engine serves the previous version for one stable release.
  Enforcer: `check:protocol-compat` (the protocol's JSON Schema against the committed snapshot: only
  additions inside a version); a test against the previous version.

<a id="section-24-2"></a>

### 24.2 Databases

- Table and column names in snake_case. Ids are UUIDv7 text with the prefixes of 24.1. Enforcer: a
  migrated-schema test over `PRAGMA table_info`; the store contract test for ids.
- Times are epoch milliseconds; amounts are decimal strings of base units (section 10). Enforcer: as
  section 10.
- Migrations are Kysely files named `NNNN_name.ts`, forward-only, each in one transaction. Enforcer:
  `check:store`; the migration runner test.

<a id="section-24-3"></a>

### 24.3 Keys, backups and the ledger

- Wallet keys live only in Privy ([decision 0085](DECISIONS.md#d0085)). The owner key and the agent
  key are P-256; the owner key is shown once as a `bnok1` code with a checksum and never stored.
  Enforcer: the key code tests (a wrong character fails the checksum) and `review-money-path`.
- The agent key's `manual`-mode file is a versioned envelope: scrypt (N=2^17, r=8, p=1) derives the
  key, AES-256-GCM encrypts. The envelope names its version, KDF and parameters. Enforcer: a
  known-answer test; `review-money-path`.
- Backups are encrypted with AES-256-GCM under a fresh data key per backup, sealed to the owner
  key's public half with HPKE (RFC 9180, DHKEM P-256), so the owner key alone opens any backup.
  Enforcer: a known-answer test.
- Each ledger entry stores SHA-256 over a stable JSON serialization of the entry (sorted keys) plus
  the previous entry's hash. Enforcer: known-answer and chain-verify tests.

<a id="section-24-4"></a>

### 24.4 Display

One formatter in `i18n` serves every surface:

- token amounts to 6 significant digits;
- USD with 2 decimals, and `<$0.01` below a cent;
- percentages with 2 decimals;
- addresses as `0x1234…abcd`, with the full checksummed address under Details;
- times in the owner's timezone (`OWNER.md`, default: the computer's).

Enforcer: Oxlint `eslint/no-restricted-globals` (`Intl`) and `eslint/no-restricted-properties`
(`toLocaleString`, `toFixed`) outside `i18n`; the formats: `i18n` table tests.

<a id="section-24-5"></a>

### 24.5 Stacks

| Part      | Stack                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console   | React 19, Vite, Tailwind 4, shadcn on Base UI, TanStack Router (typed routes), TanStack Query over `@binference/client`, `zod/mini`; the same build serves the Mini App |
| Languages | ICU messages in `packages/i18n/messages/{en,zh}/<area>.json`, formatted by FormatJS `intl-messageformat` in Node, the console, Telegram and the CLI alike               |
| Telegram  | grammY; HTML formatting                                                                                                                                                 |
| CLI       | commander and clack; every command takes `--json` and `--yes`; exit code 0 ok, 1 error, 2 refused by policy                                                             |
| Docs site | Starlight, rendering the Markdown in `apps/docs/` in English and Chinese, with its built-in search; hosted on Cloudflare Pages                                          |
| Docker    | Node `bookworm-slim` base, a non-root user, the state folder as a volume, `binference health` as the healthcheck                                                        |
| Monorepo  | pnpm and Turborepo, for 20 packages and 20 plugins                                                                                                                      |

Enforcer: `check:package-graph` (the third-party packages each package may use); a test over the
commander tree for `--json` and `--yes`, and exit code tests; an image smoke test for Docker
(`docker inspect` shows the non-root user and the healthcheck).

<a id="section-24-6"></a>

### 24.6 Published packages and versions

- npm gets four packages: `binference` (the CLI, bundling the engine, runtime, console and terminal
  chat), `@binference/protocol`, `@binference/client` and `@binference/plugin-sdk`. Every other
  package is private. Enforcer: `check:package-graph` (`private: true` on every package but the
  four).
- All published packages share one calver version. `plugin-sdk` also declares a semver API version
  that plugins state in their manifest. Enforcer: `check:package-graph` (versions equal); a manifest
  test.

<a id="section-25"></a>

## 25. Names

Decided in decisions [0074](DECISIONS.md#d0074) to [0077](DECISIONS.md#d0077).

- Every name comes from [GLOSSARY.md](GLOSSARY.md). A name from another agent framework is never
  used, in code, files, commands, config, protocol, tools, docs or UI; add a new name to the
  glossary first.
- Code copied from another project is renamed to our modules and identifiers, and covered by
  `NOTICES.md` in every build that leaves the team ([decision 0075](DECISIONS.md#d0075)).
- Enforcer: `check:style`'s reserved-name check (it holds only hashes of the names) and
  `review-diff`; for copied code, `review-diff` and a release check that `NOTICES.md` is in every
  tarball.
