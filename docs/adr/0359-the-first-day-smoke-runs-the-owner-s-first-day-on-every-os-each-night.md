# 0359. The first-day smoke runs the owner's first day on every OS each night

Status: Accepted

Accepted by the tech lead on 2026-11-04, with Privy's dev app only on a run by hand that removes
what it made there.

## Context

A new owner must go from the install one-liner to a confirmed paper trade in under 10 minutes on
macOS, Windows and Linux. Each part of that day has a smoke of its own: the one-liner
(decision 0357), the packed install's paper trade by chat (decision 0354), and `binference update`
with its rollback (decision 0356). None runs them in the order an owner meets them, on one
install, with `status`, an update and `uninstall` after the trade, and none times the whole day.

Facts that bound the choice:

- `binference update` takes only a stable or beta version (decision 0353). A nightly pack's
  `-nightly.N` version is refused, so the day's two releases need release versions.
- `binference start`, `update` and `uninstall` reach the OS's service manager. A smoke on an
  owner's machine must never install a login item, and the CI job `Background service at login`
  is the one that proves the real service managers, with a logout and a login between its phases.
- `binference update` refuses on Windows (decision 0356).
- Privy's dev app keeps at most 10 aggregations, deletes an owned one only with its owner's
  signature, and deletes no wallet. A live run that leaves what it made fills the app for the next.

## Decision

- `pnpm first-day:smoke` builds binference and packs it at two release versions, A and B, as
  `release:dry` packs it but with private manifests, so no publish takes them, and stages the
  install scripts beside them with the commit they came from. It refuses to pack from sources
  with a tracked change. `--pack-only` only packs; `--packed <folder>` runs on a folder an earlier
  pack wrote.
- The day runs in a scratch home folder with its own npm prefix and state folder, each step timed:
  1. **install**: the one-liner, served from 127.0.0.1, installs A with the pinned Node from
     nodejs.org. The launcher must print A's version, and the sources must be the commit A and B
     were packed from with no tracked change, else the run fails here.
  2. **init**: `binference init --yes` through the launcher, every answer in a
     `BINFERENCE_INIT_*` variable, each secret as a source of another variable.
  3. **start**: the engine starts as the background service and its bot polls Telegram.
  4. **trade**: the owner pairs, asks for USDT on the synthetic Bot API with a scripted model,
     taps Confirm, and gets the paper fill and the agent's report.
  5. **status**: `binference status` shows the engine ready on A, with every part's health
     signal and none failing.
  6. **update**: `binference update` to B, then the engine is ready on B and the chat answers. On
     Windows the step expects the refusal and is recorded as `refused`.
  7. **uninstall**: `binference uninstall --state --yes` names the PATH entry to remove, and the
     service, the state folder, the program, the launcher and the pinned Node are gone (decision
     0358). On Windows the smoke runs the command it printed first.
- `init`, `status` and `--version` run through the launcher, as the owner types them. `start`,
  `update` and `uninstall` run from the repository's sources on the installed program, with the
  service as a child process, as `update:smoke` runs them. Stand-ins for `launchctl`, `systemctl`
  and `loginctl` come first on PATH and log any call, which fails the step, and the launcher runs
  no other command.
- Privy, Telegram and the model are the e2e fakes behind a stand-in proxy, as in decision 0354.
  The nightly run always uses the fake Privy.
- `--privy real` runs the day on Privy's dev app, reached through the same proxy, with
  `BINFERENCE_PRIVY_APP_ID` and `BINFERENCE_PRIVY_APP_SECRET` set; without them it stops. Before
  init makes anything, the smoke keeps the owner key it hands init in the OS keychain, as the
  custody suite's live runs keep theirs. After the day, whether it passed or not, a `cleanup` step
  sweeps that key's record: the wallet lets its policies go, then the policies, the caps they
  compare and the key quorums that own nothing go, each signed by the owner key. The sweep reads
  each policy for the caps it compares, since the installed program, not the smoke, made them.
  The key leaves the keychain only once nothing it made is left; otherwise the step fails and
  `pnpm privy:sweep` finishes the job. Two live runs never run at once.
- The report, `reports/first-day/first-day-<os>.json`, holds each step's time in seconds, its
  outcome and its problems, the OS, the Node that ran the smoke, which Privy ran, and the total.
  The job only records the times; the 10-minute bar is judged on the run timed by hand.
- `packed.yml`'s pack job also packs the day's releases, and a job per OS runs the day from them
  each night and by hand, never on a push, with `contents: read`, pinned actions and a 25-minute
  limit, and uploads the report. A run by hand with the input `privy: real` hands the job the dev
  app's secrets in its run step only, runs the three OS jobs one after another, and on Linux runs
  the day inside GNOME Keyring's D-Bus session for the keychain. The workflow's concurrency group
  keeps a second run waiting.

Jobs:

| Event              | Before | After                       |
| ------------------ | ------ | --------------------------- |
| Each night         | 42     | 45: the first day on 3 OSes |
| A push to `master` | 12     | 12                          |
| A release tag      | 5      | 5                           |

## Consequences

- A change that breaks any step of the owner's first day turns the nightly run red on the OS where
  it breaks, with the step and its problems in the report.
- Every night downloads the pinned Node once per OS, and the pack job builds once more from its
  Turborepo cache.
- The real service managers stay proven by `Background service at login` alone.
- **Known gap:** `start`, `update` and `uninstall` run from the sources, so no smoke runs the
  bundled program's own `update` or `uninstall`, nor the program removing its own files while it
  runs. The install step checks that the sources are the packed commit, so the code is the same,
  not assumed the same; the bundling of those two commands stays unproven.
- A run on the dev app leaves its wallet and the key quorum that owns it, since Privy deletes no
  wallet; its policies and caps go, so the app's aggregation limit is not used up.
- Windows proves no update until `binference update` runs there.

## Alternatives

- **Run the day in `release.yml` on each tag.** A tag is cut after the nightly runs; a red day
  found then holds the release.
- **Use the runner's real service manager.** It installs a login item on the runner and would
  repeat the service job's work; the child service runs the same command line.
- **Drive the installed program's own `start`, `update` and `uninstall`.** They reach the OS's
  service manager, with no seam a packed program may take.
- **Update to a nightly pack.** `binference update` refuses its version.
- **Run the dev app every night.** Each night would add a wallet to the app and depend on its
  credentials being in CI; the fake proves the same day.
