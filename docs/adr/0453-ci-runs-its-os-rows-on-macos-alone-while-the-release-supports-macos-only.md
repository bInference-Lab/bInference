# 0453. CI runs its OS rows on macOS alone while the release supports macOS only

Status: Amended by 0454

Accepted by the tech lead on 2026-11-22.

Amends [decision 0294](0294-ci-runs-on-pushes-to-master-and-each-night-not-on-pull-requests.md)
and [decision 0295](0295-codeql-and-zizmor-scan-the-code-and-the-workflows-on-each-push-to-master.md)
on what a push runs, and
[decision 0449](0449-the-first-public-release-supports-macos-only-until-linux-and-windows-pass-ci.md),
[decision 0293](0293-a-nightly-job-builds-and-runs-the-docker-image-on-linux-amd64.md),
[decision 0339](0339-the-crash-suite-sends-stakes-and-bridges-on-stand-ins-of-the-bare-chain.md),
[decision 0354](0354-the-packed-packages-trade-on-paper-by-chat-on-every-os-nightly-and-before-each-publish.md),
[decision 0357](0357-the-install-scripts-pin-one-node-release-by-its-signed-sha-256-and-never-need-root.md)
and [decision 0359](0359-the-first-day-smoke-runs-the-owner-s-first-day-on-every-os-each-night.md)
on what a night runs, to follow decision 0449's macOS-only release.

## Context

Decision 0449 ships the first release for macOS alone. Linux and Windows return in the release
whose commit passes, on that OS, the `pnpm check` and OS jobs of `ci.yml` and the smoke,
one-liner and first-day jobs of `packed.yml`. It kept every CI row on three OSes.

GitHub Actions ran again on the push of `e8fd97501`. That push started 13 jobs:

- `pnpm check` on Linux, macOS and Windows. Linux failed after 19 minutes, 1,128 s of it the
  test run; macOS and Windows were cancelled at 21 minutes, still running.
- The Postgres store job reached its 15-minute limit.
- The OS adapters and the background service at login on three OSes, 1 to 3 minutes each.
- CodeQL, 6 minutes.

Turborepo cached 0 of 70 tasks. The cache step saves only after a job passes, and no run had
passed, so every run started cold. A newer push also left the older push's run going.

## Decision

- **A push to `master` runs 5 jobs.** `pnpm check`, the OS adapters and the background service
  at login run on `macos-latest`. The commit message check and the audit and scans job stay on
  `ubuntu-latest`: they read the repository and prove nothing about Linux. Every job keeps its
  Linux and Windows steps, so each OS returns as one matrix row.
- **One CI run per ref.** A newer push to `master` cancels the CI run of the older push.
- **Turborepo's cache** is restored by the OS, the lockfile's hash and the commit, falling back
  to the newest cache of the same lockfile, then of the OS. It is saved after `pnpm check`
  passes or fails, never after a cancel; Turborepo keeps only the tasks that passed. Turborepo
  drops entries older than 7 days at the start of each run (`TURBO_CACHE_MAX_AGE`), so the saved
  cache stops growing.
- **The test run stays as it is.** Its inputs are every tracked file, so it comes from the cache
  only for an unchanged tree, such as a run again on the same commit. Narrower inputs could hand
  back a pass for code that changed.
- **By hand only:** the Postgres store job, since Cloud does not ship; `mutation.yml`, since the
  nightly mutates every file; and `image.yml`, since the image runs Linux.
- **CodeQL** runs every Monday and by hand.
- **Each night** the seven crash suite parts and the smoke, one-liner and first-day jobs of
  `packed.yml` run on macOS alone. The Node pins and the pack jobs stay on Linux, as tool jobs.
  `fork.yml` and `nightly.yml` stay as they are.
- **An OS returns** as rows in `ci.yml`, `crash.yml` and `packed.yml`, and for Linux with
  `image.yml`'s nightly schedule. The change that brings them back runs `ci.yml` and `packed.yml`
  by hand on its branch, and decision 0449's return rule reads that run.

Jobs:

| Event              | Before                                                  | After                                                  |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------ |
| A push to `master` | 13: `ci.yml` 12, CodeQL; 14 with mutation               | 5: 3 on macOS, 2 on Linux                              |
| Each night         | 54: crash 21, packed 11, image, fork, Stryker 20 shards | 33: crash 7, packed 5, fork, Stryker 20                |
| Monday             | CodeQL adds 1                                           | CodeQL adds 1                                          |
| By hand            | any workflow                                            | any workflow; Postgres, mutation and the image only so |

## Consequences

- A push takes about 28 runner minutes instead of about 100. `pnpm check` on macOS sets the
  run's length, 20 minutes or more, most of it the test run; the other four jobs end within 3
  minutes. The first runs on macOS alone measure it.
- No CI run proves Linux or Windows. A fault there shows only in a run by hand, and the install
  script's stop on Linux (decision 0449) has no nightly row left to prove it.
- A cancelled run checks nothing of its push. The commit messages and the base comparisons of its
  commits (the decision lock, the migration lock, the suppressions baseline) reach no CI run,
  since the next run starts from its own push. The merger's local `commitlint` and `check:pr`
  still read them before the push.
- Mutation testing waits for the night, and a CodeQL alert can wait up to a week.
- The Postgres forms of the store are tested by hand or on a laptop with Docker.

## Alternatives

- **Keep three OSes on each push and night.** About 100 runner minutes a push go to OSes no
  release supports, and their first failures decide nothing.
- **Delete the Linux and Windows steps.** Each OS would come back as new code to review, as
  decision 0449 found for the install script.
- **Cancel only the macOS jobs.** Job-level groups would let every push's commit check finish,
  but the base comparisons inside `pnpm check` would still skip a cancelled push.
- **Narrower inputs for the test run.** A shared module outside them could change while a cached
  pass stays.
