---
name: tune-ci
description: Changes the GitHub workflows without making CI slower, costlier or less safe, and finds why a run waits or takes long. Use when you add or edit a job in .github/workflows, add a matrix row, or a run sits queued or runs past its usual time.
---

# Tune CI

CI runs on GitHub-hosted runners only. Every job a change adds runs on each push to every pull
request, often on three operating systems. Count before you add.

## 1. Know what runs

| Workflow       | When                                    | Jobs                                                                                   |
| -------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| `ci.yml`       | each pull request push, each `master`   | `pnpm check`, OS adapters and the service smoke on 3 OSes; `check:pr`; audit and scans |
| `mutation.yml` | a pull request touching engine, signer  | Stryker on the changed files                                                           |
| `fork.yml`     | nightly 03:41 UTC, by hand              | the fork suite on Linux                                                                |
| `crash.yml`    | nightly 04:23 UTC, by hand              | the crash suite on 3 OSes, `BINFERENCE_CRASH_RUNS` runs per kill point                 |
| `image.yml`    | nightly 01:13 UTC, by hand              | the Docker image suite on Linux amd64                                                  |
| `nightly.yml`  | nightly 02:17 UTC, a full run on Sunday | Stryker in 20 shards with saved results                                                |

A pull request push starts 11 jobs, 12 with the mutation job. A newer push cancels the older run
of the same pull request (`cancel-in-progress`); runs on `master` and the nightly suites never
cancel each other. The nightly workflows start at different times so their jobs do not queue
behind each other.

## 2. Find the bottleneck first

Read the run before you change a workflow:

```sh
gh run list --workflow ci.yml --limit 10
gh run view <run-id> --json jobs --jq '.jobs[] | [.name, .status, .startedAt, .completedAt] | @tsv'
gh run view <run-id> --log-failed
```

- **Queued, no runner yet:** the account's concurrent job limit is full, often with nightly shards
  or several pull requests. Fewer parallel rows help; a bigger timeout does not.
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
- Every workflow sets `permissions: read-all` or less, and a `concurrency` group.
- Actions are pinned to a full commit SHA with the version in a comment. A downloaded tool is
  pinned by version and checked against its published SHA-256.
- `actions/checkout` keeps `persist-credentials: false`.
- No secret reaches a job that runs code from a pull request. The fork and crash suites hold no
  key and must stay that way.
- `pnpm check` and the OS jobs run on Linux, macOS and Windows (rule OS-6 of
  `docs/ENGINEERING.md`). A job that reads no OS behavior, such as a scan or `check:pr`, runs on
  Linux alone: macOS and Windows minutes cost more.
- A new shard count, a new nightly job or a new required check is load-bearing: run `write-adr`
  with the job count per push and per night, and the time it saves.
- Run `actionlint` on the changed workflow. CI runs it, with OpenGrep and the audit.

## 4. Check the effect

Compare three runs before and three after: queued time, run time per job and the total minutes
per OS. A change that saves time on Linux and adds a macOS row may cost more than it saves.

## 5. Report

What waited or ran long and why, the change, the job count per push before and after, the
numbers from step 4, and the run links.
