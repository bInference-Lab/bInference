# 0294. CI runs on pushes to master and each night, not on pull requests

Status: Accepted

## Context

GitHub Actions has been off since 2026-10-11. Before that, `ci.yml` ran on every pull request push
and every push to `master`, and `mutation.yml` ran on pull requests that touch `engine`, `signer`
or `stryker.config.mjs`. Changes reach `master` through one stream: branches are checked and
merged locally, and a maintainer pushes `master`, often with many merged branches at once (up to
about 30 commits). Pull request runs would test the same commits a second time, and hosted
minutes on macOS and Windows cost more than on Linux. The owner chose, on 2026-10-29, to turn
Actions back on for pushes to `master` and the nightly jobs only.

Jobs before this decision:

| Event               | `ci.yml` | `mutation.yml`                  | Nightly |
| ------------------- | -------- | ------------------------------- | ------- |
| A pull request push | 11       | 1 when engine or signer changed | 0       |
| A push to `master`  | 11       | 0                               | 0       |
| A night (every day) | 0        | 0                               | 34      |

`ci.yml` holds `pnpm check`, the OS adapters and the service smoke on 3 OSes (9 jobs), `check:pr`
on pull requests, the commit message check on `master`, and the audit and scans. A night holds
the image suite (1 job), Stryker in 20 shards, the fork suite (1) and the crash suite in 4 parts
on 3 OSes (12).

## Decision

- **`ci.yml` runs on pushes to `master` and by hand** (`workflow_dispatch`), never on a branch
  push or a pull request. Its concurrency group is the commit, so a run on `master` never cancels
  or replaces another; a run by hand on the same commit waits.
- **The checks that compare with a base** (the decision lock, the migration lock, the size
  baseline) compare with `master` before the push. A first push, a forced push or a run by hand
  has no such commit in the history; those compare with the parent commit.
- **The commit message check covers every pushed commit**, not only the last one, since a push
  carries whole branches.
- **`check:pr` leaves CI.** The merger runs it before each merge on the branch's range:
  `pnpm check:pr master..<branch>`, with `--title` and `--body <file>` for a squash merge of a
  pull request. Without a body file it says so and checks the branch name, the commits and the
  size only.
- **`mutation.yml` runs on pushes to `master` that touch the money core, and by hand.** A push
  starts it when it changes `packages/engine/`, `packages/signer/` or `stryker.config.mjs`; a run
  by hand takes a base commit (`HEAD~1` by default). It diffs `master` before the push with the
  pushed commit. When the push names no commit in the history, it mutates nothing, says so in the
  job summary, and leaves the files to the nightly; it never mutates a whole package.
- **The mutation job is bounded.** It mutates at most the 12 changed source files with the most
  changed lines, lists the rest in the summary for the nightly, and stops Stryker at 45 minutes
  with a warning. The job's timeout is 60 minutes: 45 for Stryker, 5 for it to stop, about 10 to
  set up and report. The last 32 commits before this decision changed 29 source files of the
  money core. The nightly's plan of 20 shards of 70 minutes over 689 files allows about 2 minutes
  a file, so 12 files take about 25 minutes by estimate. No Stryker run of today's suites has been
  timed on a hosted runner; the first runs on `master` set the cap.
- **The nightly workflows keep their schedules.** None of them runs on a pull request.

Jobs after this decision:

| Event                         | `ci.yml` | `mutation.yml`                  | Nightly |
| ----------------------------- | -------- | ------------------------------- | ------- |
| A branch or pull request push | 0        | 0                               | 0       |
| A push to `master`            | 11       | 1 when engine or signer changed | 0       |
| A night (every day)           | 0        | 0                               | 34      |

## Consequences

- No CI minutes go to branches or pull requests; each change is tested once, on `master`.
- A regression on Linux or Windows that a macOS laptop cannot see shows only after the push that
  merges it. Two answers: a red run on `master` stops the line, and nothing else is pushed until
  the fix is; a change to Windows-specific code (paths, the keychain, the background service) runs
  CI by hand on its branch, or its tests on Windows, before the push that merges it.
- A pull request from outside shows no CI result. A maintainer runs `pnpm check` and `check:pr`
  on its branch before merging.
- A push of more than 12 changed money-core files leaves the rest to the next night.
- The `master` ruleset can require no status check, since no check runs before a merge.

## Alternatives

- **CI on pull requests as before.** Every change would run twice, once on its pull request and
  once on `master`, for a merge stream that a maintainer already checks locally.
- **The whole money core on each push when the base is unknown.** About 689 files take far longer
  than one job's timeout; the nightly covers them.
- **Stryker on every changed file with no cap.** A 30-commit push would run past the timeout and
  end with no score at all.
- **A shard per changed file group on each push.** It adds parallel jobs to every push for work
  the nightly already does.
