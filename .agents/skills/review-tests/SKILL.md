---
name: review-tests
description: Judges whether a test earns its place, when you write one and when you sweep a package for tests that pin code instead of behavior. Use before adding or changing a test, and when asked to clean up a package's tests.
---

# Review the tests

A test runs on every change for years. It earns that when it goes red on a mistake a person would
feel: a wrong amount, a lost card, a broken call, a word missing in Chinese. Use this skill on a
test you are about to write, and on a folder of tests you are asked to clean up.

## 1. A new test

Write down, before the test:

1. **The promise.** The sentence from the spec, the package's `AGENTS.md` or the TSDoc that the
   test holds the code to. No promise, no test.
2. **The layer.** The cheapest one that can see the promise: a unit test for a rule, a contract
   suite for a port, a composed test in `packages/cli/src/compose/` for wiring, the fork suite for
   the chain, the crash suite for a kill between signing and receipt.
3. **The owner.** The test that already holds this promise, if any. Add a case to its table
   instead of writing a second test.
4. **The entry point.** Test through what callers use. If the test needs a new export or flag
   that no caller needs, test one level up.

For a bug, the test goes red on the old code for the reason the bug names, and green after the
fix. Keep both runs for the pull request.

## 2. Tests to rewrite or delete

**It proves nothing.** It has no assertion or only checks that nothing threw; its expected value
comes from the code under test; it would pass if the function body were empty.

**It proves the code's shape, not its behavior.** It counts internal calls, greps source text,
copies an export list or a message file, or goes red when a module is split without a change a
caller could see.

**It proves the fake.** Its fake makes the decision the test asserts; it checks rows in a fake
store the real path never writes; it asserts what the engine reports where the promise is about
what reached the chain (the crash suite counts transactions at the relays and in anvil for this
reason).

**It proves something else.** Its name promises a refusal, and the refusal it sees comes from
another check; it is a `.zh.test.ts` file that never reads a Chinese message.

## 3. Tests that stay

These guard contracts other code relies on. Keep them even when they look plain or slow:

- contract suites, and each adapter's and fake's run of them;
- the intent state machine's full transition table, and every property test of policy and amounts;
- the money rules of `review-money-path`: bigint amounts, decimal strings on the wire, the recheck
  before signing, no retry after a side effect, the raw transaction stored before broadcast;
- each operation's example call and the protocol compatibility snapshot;
- migrations, the config schema and its migrations, error codes and their messages;
- English and Chinese message checks;
- fork tests of registry addresses and venue calls, and the crash suite.

A slow test gets faster (`speed-up-tests`); it does not go.

## 4. A sweep

1. Read the package's `AGENTS.md`, its `ports.ts` and one folder's tests. Do not edit yet.
2. For each candidate, note its file and name, the group from section 2 it falls in, the test that
   still holds the promise after it goes, and any export or helper only it uses.
3. Change only candidates with every note filled in. One folder per commit, type `test`.
4. Delete the exports, flags and helpers that only the removed tests used.
5. Run the folder's tests. `pnpm check` runs once, when the sweep ends.

## 5. Report

Each test removed or rewritten with its group, the tests you looked at and kept with the reason,
the lines of source and of tests removed, and the commands you ran.
