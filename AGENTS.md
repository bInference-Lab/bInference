# binference

binference is an open-source AI agent that trades on BNB Smart Chain for its owner. It runs on the
owner's machine, talks on Telegram, in a web console and in the terminal, and asks before every
transaction. This file holds the rules every engineer and coding agent follows. Each package has
its own `AGENTS.md`; read it before you change a file there.

The full rules are in [docs/ENGINEERING.md](docs/ENGINEERING.md), the architecture in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the specs in [docs/specs/](docs/specs/), and the
decisions in [docs/DECISIONS.md](docs/DECISIONS.md). When those are silent, write a short ADR and
get the maintainers' yes before coding. Never make a random choice.

## Principles

- The engine is the trust boundary. Keys, confirmations, limits and the ledger live only in the
  engine and the signer; everything else reads and proposes.
- One owner per responsibility. One module decides and writes each piece of state.
- Small core, capable plugins. A new venue, chain, model provider or chat surface is an adapter
  behind an existing port, never an `if` in the core.
- Chain-agnostic and OS-agnostic. Core code never names a chain, an operating system, a model
  provider or a database.
- Fail closed on money, fail soft on telemetry.
- A change moves every caller and deletes the old path in the same PR.
- Every action has a visible outcome, and an error tells the reader the next step.

## Names

Every name comes from [docs/GLOSSARY.md](docs/GLOSSARY.md). Never borrow file names, commands, config keys,
protocol names, tool names or terms from other agent frameworks; add a new name to the glossary
first.

## TypeScript

- TypeScript 7, ESM only, Node `>=26.1`. `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedDeclarations`.
- No `any`, no non-null `!`, no `enum`, no `namespace`, no default export, no `@ts-ignore`.
  `as` only in tests and named assertion helpers.
- `unknown` only at a boundary, parsed by zod at once. An exported shape has a declared type and
  a schema annotated with it ([decision 0098](docs/DECISIONS.md#d0098)); no `z.infer` in an
  exported position.
- Branded types for ids, accounts, assets and amounts. Money is `bigint` base units, never
  `number`. Rates are integer basis points.
- Exhaustive `switch`; `readonly` data; never mutate an input.
- Every async I/O takes an `AbortSignal` and has a timeout. No floating promises.
- Pure packages read time and randomness only through the `Clock` and `Random` ports.

## Clean code

- File 300 code lines (tests 600), function 50, complexity 10, nesting 3, parameters 3.
- One concept per file, named after its main export. No `utils.ts` or `helpers.ts`. No barrel
  files except a package's `src/index.ts`.
- Factory functions and interfaces; classes only for errors. One composition root in `cli`.
- Ports and adapters: domain code depends on ports; adapters are wired in the composition root.
  Every port has one contract test suite that each adapter passes.
- No duplication: extract the second copy into the lowest shared package. No speculative
  helpers or one-use wrappers.
- Expected outcomes return `Result`; faults throw `BinferenceError` with a dotted code.
- An outside service (a venue, custody, a chat app, a data feed) is reached through its official
  SDK when one fits, at its latest release and the way its docs recommend; endpoints and addresses
  come from its official docs ([docs/ENGINEERING.md](docs/ENGINEERING.md) section 17).

## Comments

- TSDoc on every public export: what it does and what a caller must know.
- A `//` comment only for a non-obvious constraint (ownership, ordering, cleanup, platform). Never
  narrate code. No `TODO`; open an issue.

## Writing

Docs, UI messages, comments, commits and PR text:

- No em or en dashes as punctuation. No emojis outside the card icons the design names.
- No filler or hype words (`easy`, `simple`, `just`, `seamless`, `robust`, `delve`, `utilize`,
  `very`, `really`, `powerful`, `effortless`, `elevate`, `streamline`).
- No plan or task ids, no people's names, no `as discussed`.
- Short sentences, active voice, present tense.
- Every word a person sees ships in English and Simplified Chinese in the same PR.

## Commits

Every PR is squashed into one commit on `master`, and its title becomes the subject. The release
notes are written from those subjects, so each one must read as a line of release notes. The full
rules are in [docs/ENGINEERING.md](docs/ENGINEERING.md#section-19) section 19.

**The subject:** `type(scope): description`, 72 characters at most.

- `type`: `feat` (something new), `fix` (wrong behavior made right), `perf`, `refactor` (same
  behavior, existing tests unchanged), `test`, `docs`, `ci`, `build` (toolchain and
  dependencies) or `chore`. When two fit, use the one the user notices.
- `scope`: one name, never two. The package (`engine`, `signer`, `telegram`), the plugin
  (`pancakeswap`), a feature folder of `engine` or `runtime` (`orders`, `policy`), or `deps`,
  `skills`, `dev-skills`, `docs`, `release`. No scope only for a change across the repo.
- `description`: lowercase, no period, says exactly what changed in a teammate's words. A fix
  names what the user saw. No vague words ("improve", "enhance"), no emojis, no dashes as
  punctuation, no issue numbers (`Closes #N` goes in the PR body).
- A breaking change adds `!` (`feat(protocol)!: ...`) and a body paragraph starting `Breaking:`.
- No AI attribution lines. `Co-authored-by` names people only.
- Example: `fix(orders): stop a trailing stop from firing twice after a restart`.

**What one commit holds:**

- One reason to exist. If the subject needs "and" to join two unrelated changes, split it.
- Everything that reason needs: code, tests, TSDoc, English and Chinese messages, docs, the config
  migration, the ADR. Callers move and the old path is deleted in the same commit.
- Green on its own on Linux, macOS and Windows, and revertable alone.
- Apart, each in its own commit: a refactor or rename a feature needs (first), formatting-only
  changes, one dependency update, an unrelated fix found on the way.
- Together: a migration and the code that needs it; generated files and their cause.
- Over about 400 changed lines: a stack of PRs (ports and types, then the adapter, then the
  wiring), each useful alone, unfinished behavior behind a config switch.
- Stage only what the change needs and read `git diff --staged`. Never commit secrets, `.env`
  files, keystores or local paths.

**Branches:** `<type>/<short-name>`, one task each. Commits are signed and the author is the real
person.

## Commands

Node 26.1 or later. pnpm switches itself to the version in `package.json`.

| Command                            | What it does                                                         |
| ---------------------------------- | -------------------------------------------------------------------- |
| `pnpm install`                     | Installs dependencies at their exact, 7-day-old versions             |
| `pnpm setup`                       | Links `.claude/skills` to `.agents/skills`                           |
| `pnpm check`                       | Runs every gate through Turborepo; a second run comes from the cache |
| `pnpm format`                      | Formats with oxfmt                                                   |
| `pnpm lint`                        | Oxlint with the type-aware rules and the `guards` plugin             |
| `pnpm typecheck`                   | TypeScript 7 over packages and repo scripts                          |
| `pnpm test`                        | Vitest with coverage bars by package tier                            |
| `pnpm test:fork`                   | The fork suite on an anvil fork of BSC; needs anvil and the network  |
| `pnpm build`                       | tsdown for each package, ESM and `.d.ts`                             |
| `pnpm gen:package <name>`          | A new package with its files and its row in the package graph        |
| `pnpm check:package-graph --write` | Regenerates the import rules after a change to the package graph     |
| `pnpm check:style --files <file>`  | The style guard on one file                                          |
| `pnpm check:gates`                 | Plants a violation for each gate and checks that the gate fails      |
| `pnpm mutation`                    | Stryker on the money core                                            |

What each package may import is in `config/package-graph.json`; edit the graph, never the
generated rules in `config/oxlint/`.

## Skills

Skills live in `.agents/skills/`. Run the first two on every change, in this order:

- `clean-diff`: strips filler from your diff before review.
- `review-diff`: reviews the diff against the rules no tool checks.
- `shape-commit`: checks that the change is one commit's worth and writes its subject.
- `review-money-path`: the checklist for a change that can move funds.
- `add-migration`: adds a migration to the store.
- `write-adr`: records a load-bearing decision.

## Before you finish

1. The behavior is tested at the cheapest layer that proves it.
2. Public exports carry TSDoc; new user-facing words exist in English and Chinese.
3. A config change has its migration; a load-bearing decision has its ADR.
4. `pnpm check` passes. CI runs it on Linux, macOS and Windows.
