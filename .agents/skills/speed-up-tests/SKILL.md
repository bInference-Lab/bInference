---
name: speed-up-tests
description: Finds why a test file or a suite is slow or heavy on memory and fixes the cause, with numbers before and after. Use when a test command runs past a minute, a worker runs out of memory, or the CI test step grows.
---

# Speed up the tests

Measure first, change one thing, measure again with the same command. A guess about runner
settings is not a fix.

## 1. Measure

Run the slow file alone, with one worker, so the numbers belong to it:

```sh
/usr/bin/time -l pnpm vitest run <file> --maxWorkers=1 --reporter=verbose
/usr/bin/time -l pnpm vitest run <file> --maxWorkers=1 --logHeapUsage
```

On Linux use `/usr/bin/time -v`. Write down the wall time, Vitest's own duration (tests, imports,
setup), the maximum resident memory and the user and system CPU time. Run it twice and keep the
second numbers, so a cold cache does not count.

For a whole package, run its folder the same way and sort the verbose output by duration.

## 2. Find the cause

Compare where the time goes:

- **Import time is large:** the test pulls in a heavy module graph. Look for an import of a
  package root when one subpath would do, or a test that builds the whole composition root when a
  use case and its fakes would prove the same thing.
- **Setup time is large:** a `beforeEach` that opens a store, starts a worker or a server, or
  builds the engine for each test. Build it once per file when the tests do not change it, and
  reset only the state they do change.
- **One test is slow:** it waits. A test that waits on real time is broken: use the fake `Clock`
  and advance it. A property test with many runs: lower `numRuns` only when the property still
  covers its edges.
- **A worker or a child process stays open:** the file ends late or the run hangs. Close every
  worker, server, client and database a test opens, in an `afterEach` or `onTestFinished`.
- **Memory grows run after run:** keep a heap snapshot before you call it a leak. A module graph
  kept alive by `isolate: false` is not a leak; a store, timer or listener kept across tests is.

## 3. Fix it

- Change the test or its fixture, not the code under test, unless the code itself is slow for
  users too.
- Keep the coverage: if a slow end-to-end test goes, the behavior it proved needs a faster test
  at a lower layer in the same change. Say what coverage moved.
- Never fix speed with a higher timeout, fewer assertions, a skipped test or a retry.
- Never move a package to the `isolated` project to hide state a test leaves behind; clean up the
  state instead.

## 4. Measure again

Run the same command as in step 1, on the same machine, twice. Give each number from step 1 as
`before -> after`, for example `wall 41.2 s -> 6.8 s`, and say which number moved for which reason.

Then run the changed folders' tests. The full `pnpm check` runs once, at the end of the work.

## 5. Report

The cause, the files changed, the numbers before and after, the coverage you kept or moved,
and the commands you ran.
