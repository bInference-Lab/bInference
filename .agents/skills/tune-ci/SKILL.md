---
name: tune-ci
description: Changes the GitHub workflows without making CI slower, costlier or less safe, and finds why a run waits or takes long. Use when you add or edit a job in .github/workflows, add a matrix row, or a run sits queued or runs past its usual time.
---

# Tune CI

CI runs on GitHub-hosted runners only, on pushes to `master` and each night, never on a branch push
or a pull request (decision 0294). Every job a change adds runs on each push to `master`, often on
three operating systems. Count before you add.

## 1. Know what runs

| Workflow       | When                                             | Jobs                                                                                        |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `ci.yml`       | each push to `master`, by hand                   | `pnpm check`, OS adapters and the service smoke on 3 OSes; commit messages; audit and scans |
| `codeql.yml`   | each push to `master`, Monday 05:37 UTC, by hand | CodeQL's security queries on the TypeScript and JavaScript sources, on Linux                |
| `mutation.yml` | a `master` push touching engine, signer; by hand | Stryker on up to 12 changed files, 45 minutes at most                                       |
| `fork.yml`     | nightly 03:41 UTC, by hand                       | the fork suite on Linux                                                                     |
| `crash.yml`    | nightly 04:23 UTC, by hand                       | the crash suite on 3 OSes, `BINFERENCE_CRASH_RUNS` runs per kill point                      |
| `image.yml`    | nightly 01:13 UTC, by hand                       | the Docker image suite on Linux amd64                                                       |
| `nightly.yml`  | nightly 02:17 UTC, a full run on Sunday          | Stryker in 20 shards with saved results                                                     |

A push to `master` starts 12 jobs, 13 with the mutation job; a night starts 34, and Monday adds
the weekly CodeQL run. Each pushed commit
has its own concurrency group, so runs on `master` never cancel or replace each other, and the
nightly suites never cancel either. The nightly workflows start at different times so their jobs
do not queue behind each other.

`check:pr` is no CI job: the merger runs it on the branch's range before the merge, as
`pnpm check:pr master..<branch>`, with `--title` and `--body <file>` for a squash merge.

## 2. Find the bottleneck first

Read the run before you change a workflow:

```sh
gh run list --workflow ci.yml --limit 10
gh run view <run-id> --json jobs --jq '.jobs[] | [.name, .status, .startedAt, .completedAt] | @tsv'
gh run view <run-id> --log-failed
```

- **Queued, no runner yet:** the account's concurrent job limit is full, often with nightly shards
  or several pushes to `master`. Fewer parallel rows help; a bigger timeout does not.
- **Started late:** a `needs:` dependency held it, or the cache restore was slow.
- **One step dominates:** usually `pnpm check`'s tests. Read Turborepo's summary for a cache miss,
  then use `speed-up-tests` on the slow files.
- **Fails on one OS only:** a path, a line ending, a permission or a service manager difference.
  Fix it in `platform`, never by skipping the OS.
- **Fork job flakes:** public BSC nodes answer bursts with 403 for up to a minute. The fork
  helpers wait and try again; a new test with many reads at once needs the same.

## 3. Rules for a workflow change

- Every job sets `timeout-minutes` close to its slowest normal run plus a margin, never the
  default six hours.
- Every workflow sets `permissions: contents: read` and a `concurrency` group. A job that needs
  more names it at the job, with a comment, as CodeQL does for `security-events: write`.
- Actions are pinned to a full commit SHA with the version in a comment. A downloaded tool is
  pinned by version and checked against its published SHA-256.
- `actions/checkout` keeps `persist-credentials: false`.
- No secret reaches a job that runs code from a pull request. The fork and crash suites hold no
  key and must stay that way.
- `pnpm check` and the OS jobs run on Linux, macOS and Windows (rule OS-6 of
  `docs/ENGINEERING.md`). A job that reads no OS behavior, such as a scan or the commit message check, runs on
  Linux alone: macOS and Windows minutes cost more.
- A change to Windows-specific code runs CI by hand on its branch (`workflow_dispatch`), or its
  tests on Windows, before the push that merges it: CI on `master` sees it only after the merge.
- A red `master` run stops the line: nothing else is pushed until the fix is.
- A new shard count, a new nightly job or a new required check is load-bearing: run `write-adr`
  with the job count per push and per night, and the time it saves.
- Run `actionlint` and `zizmor --offline .github/` on the changed workflow. CI runs both, with
  OpenGrep and the audit; `.github/zizmor.yml` says why each disabled audit is off.

## 4. Check the effect

Compare three runs before and three after: queued time, run time per job and the total minutes
per OS. A change that saves time on Linux and adds a macOS row may cost more than it saves.

## 5. Report

What waited or ran long and why, the change, the job count per push before and after, the
numbers from step 4, and the run links.
