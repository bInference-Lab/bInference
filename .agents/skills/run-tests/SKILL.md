---
name: run-tests
description: Picks the tests that prove a change, runs them at a low worker count, and says where each kind of test lives. Use while writing or fixing code, before clean-diff, and when a test fails.
---

# Run the tests

A change is proven by the cheapest test that would fail without it. Run that test while you work,
and the full `pnpm check` once, when the change is complete.

## 1. Know the kinds

| Kind       | Where it lives                                    | How it runs                     |
| ---------- | ------------------------------------------------- | ------------------------------- |
| Unit       | `<pkg>/src/**/<module>.test.ts`, beside the code  | `pnpm vitest run <path>`        |
| Chinese    | `<module>.zh.test.ts`: text a person reads in zh  | `pnpm vitest run <path>`        |
| Contract   | `src/contracts/<port>-contract.ts`, one per port  | from each adapter's own test    |
| Property   | `<module>.property.test.ts`, fast-check           | `pnpm vitest run <path>`        |
| End to end | `src/e2e/`: a real process or the composed engine | `pnpm vitest run <path>`        |
| Fork       | `src/fork/`: anvil on a fork of BSC               | `pnpm test:fork <path>`         |
| Crash      | `src/crash/`: kills and restarts an engine        | `pnpm test:crash <path>`        |
| Image      | `src/image/`: builds and runs the Docker image    | `pnpm test:image`               |
| Mutation   | Stryker over `engine` and `signer`                | CI only; never in a task's loop |

`pnpm check` and `pnpm test` skip the fork, crash and image folders. Those suites run each night in
CI. The image suite needs Docker; run it by hand, alone, after a change to the Dockerfile,
`.dockerignore` or how the `binference` package is built.

## 2. Pick the proof

- A pure function or a rule: a unit test in the module's own test file.
- A policy or amount module (`policy/*.ts`, `*amount*.ts`): also a property test beside it;
  `check:layout` fails without one.
- A new port: a contract suite named `<port>Contract`, exported from a `*-contract.ts` file, and a
  hand-written fake in `src/fakes/` whose test runs the suite. Every adapter's test runs it too.
  `check:contract-suites` checks both.
- A fake in a test: use the package's `testing` export (`@binference/<pkg>/testing`), never
  `vi.mock` in a pure package.
- A wiring change across packages: a test in `packages/cli/src/compose/` on the test composition.
- A chain call, a venue's contract or a registry address: a fork test.
- A step between signing and receipt: a crash test.
- A bug: a test that fails on the old code for the reason the bug names. Keep the failing run for
  the pull request's evidence.

## 3. Run it

```sh
pnpm vitest run packages/engine/src/limits --maxWorkers=2
pnpm vitest run packages/engine/src/limits/limit-handlers.test.ts -t "<test name>"
pnpm test:fork plugins/kyberswap/src/fork
BINFERENCE_CRASH_RUNS=1 pnpm test:crash packages/cli/src/crash
```

- Keep `--maxWorkers=2` on a laptop that others share. One test command at a time; never two
  Vitest runs side by side.
- A crash pass prints its runs per kill point, its kill points, its estimated time and its
  results file in `reports/crash/`, which gets each run's result as the run ends: read it while a
  long pass runs, or after one was stopped. A part estimated over 120 minutes is refused. After a
  change to a kill point's speed or a new kill point, refresh the times: run the changed file at
  `BINFERENCE_CRASH_RUNS=1`, then `pnpm crash:times reports/crash/<file>.jsonl`.
- The fork and crash suites need `anvil` on the `PATH`. The fork suite also reads public BSC
  nodes, which refuse bursts for a while: a 403 there is the network, not your code.
- A test command that runs past a minute is a finding. Stop it and find out why before running it
  again (see `speed-up-tests`).

## 4. After a merge

The merger runs the after-merge set on `master` after each merge:

```sh
pnpm test:after-merge                  # what the last merge brought, ORIG_HEAD..HEAD
pnpm test:after-merge master@{1}..master
pnpm test:after-merge <base>..<head> --list
```

It runs the tests of every package the range changed and of every package that depends on one, the
table tests that read every notice key, card key and reason code (a key added without its rows in
another package's table fails only here), the repo checks two merged branches can break together, on
half the cores, and `check:gates` when a gate's script or config changed. `--list` prints what it
chose and why without running it. A new test that reads a whole catalog of another package joins its
list in `scripts/after-merge/after-merge-plan.mts`.

## 5. When a test fails

1. Read the assertion and the first stack frame in our code. Run that one test alone.
2. Decide which side is wrong: the code, the test, a fake that drifted from its contract, or the
   machine. A test that passes alone and fails in the full run leaves state behind: files share
   their worker's modules, so a stub or a global must come back after each test.
3. Fix the cause. Never add a retry, a longer timeout, a sleep or a looser assertion to get green.
4. Run the failing test, then its folder, then `pnpm check` once at the end.

## 6. Rules every test keeps

- Names are sentences in lowercase with no period: `rejects a swap above the daily cap`.
- No network (a refusing dispatcher is installed), no real timers, no sleeps, no polling. Time
  comes from a fake `Clock`.
- No conditional tests or expects, no `.only` or `.skip`, every `expect` awaited.
- The 30-second test timeout catches a hang. Never raise it for a slow test; make the test faster.

## 7. Report

Name the tests you added or changed, the commands you ran and what they showed.
