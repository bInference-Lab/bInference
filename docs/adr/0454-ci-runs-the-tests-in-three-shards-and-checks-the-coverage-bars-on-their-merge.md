# 0454. CI runs the tests in three shards and checks the coverage bars on their merge

Status: Accepted

Accepted by the tech lead on 2026-11-22.

Amends [decision 0453](0453-ci-runs-its-os-rows-on-macos-alone-while-the-release-supports-macos-only.md)
on what a push runs and on the test run's cache.

## Context

Decision 0453 runs `pnpm check` as one job on `macos-latest`. Its test run, `vitest run
--coverage` over every package with the coverage bars of `vitest.config.ts`, sets the length of
a push's run. It took 1,128 s of a 19-minute `pnpm check` on Linux; on the 3-core macOS runner
the job was still running when it was cancelled at 22 minutes. Every other job of a push ends
within 3 minutes, and the other gates of `pnpm check` share the job's CPU with the tests.

Three facts shape the split:

- Vitest shards by test file (`--shard=<i>/<n>`), writes each shard's results and coverage to a
  blob report, and merges them with `vitest run --merge-reports --coverage`. It checks the
  coverage bars in every run, a shard included: one shard of the money folder's tests reached
  84% of its lines against the 95% bar and failed.
- Turborepo 2.11 has no flag that runs a task list less one task; its parser refuses task tags.
- The coverage holds absolute file paths, which the bar of one package matches against the
  merging checkout.

## Decision

- **The `check` job runs every gate of `pnpm check` but its test run.** It reads the task list
  from the `check` script in `package.json` and drops `test`, so a gate added there runs in CI
  too. It fails when the script is no longer a `turbo run` with a `test` task.
- **Three `test` jobs** on `macos-latest` each run `pnpm test --reporter=blob --shard=<i>/3`, as
  Vitest's sharding guide does, through `vitest.shard.config.ts`: the root config without the
  coverage bars. Each keeps its `.vitest` folder as an artifact for 1 day, after failed tests
  too.
- **The `coverage` job** downloads the three reports on the same OS and runs
  `vitest run --merge-reports --coverage` with the root config, so every bar of `pnpm test`
  holds on the whole run. It runs after the shards whether they passed or not, so its report
  names every failed test, and it fails when any shard did not pass.
- **Local `pnpm check` stays as it is**, one `turbo run` with the test run among its tasks. Git
  leaves out `.vitest/`, where a shard run on a laptop writes its blob report.
- Each new job keeps its Linux and Windows row as a comment, as decision 0453 does.

Jobs:

| Event              | Before                    | After                                                                 |
| ------------------ | ------------------------- | --------------------------------------------------------------------- |
| A push to `master` | 5: 3 on macOS, 2 on Linux | 9: 7 on macOS (`check`, 3 shards, the merge, the OS jobs), 2 on Linux |
| Each night         | 33                        | 33                                                                    |

## Consequences

- A push's run should take about 12 minutes instead of 22 or more: about 1 minute to set up and
  about 9 to run a third of the files with coverage, then about 2 for the merge. The first runs
  measure it, and the shard count or the timeouts follow those numbers. On an 18-core Mac at 9
  workers, each shard took 67 to 73 s, the merge 4 s and the other gates 71 s.
- A push costs about 6 more macOS runner minutes: four more set-ups, the coverage of untested
  files worked out in each shard, and the merge.
- Six macOS jobs start at once. On a plan with 5 concurrent macOS jobs, one waits until an OS
  job ends, about 2 minutes.
- The test run no longer comes from Turborepo's cache, so a run again on the same commit runs the
  tests again.
- Vitest splits by file, not by time, so one shard can run longer than the others.

## Alternatives

- **Copy the gate list into `ci.yml`.** A gate added to `pnpm check` would miss CI.
- **Task tags to leave the test task out.** Turborepo 2.11 refuses them.
- **An environment switch in `vitest.config.ts` that drops the bars.** Any run could set it; the
  shard config is named only by CI.
- **Shards on Linux.** Cheaper minutes, but decision 0453 keeps the OS rows on macOS while the
  release supports macOS alone.
- **More shards.** Each adds a set-up and a macOS slot; three is the count the run's numbers ask
  for until the first runs say otherwise.
