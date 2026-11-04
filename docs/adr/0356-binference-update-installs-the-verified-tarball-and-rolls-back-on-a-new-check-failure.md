# 0356. binference update installs the verified tarball and rolls back on a new check failure

Status: Accepted

Accepted by the owner on 2026-11-04, the `update_checking` lock and the Windows refusal included.

## Context

[Decision 0047](../DECISIONS.md#d0047) and ARCHITECTURE section 24: `binference update` backs up,
verifies the npm provenance, installs, runs `check`, and restores the previous version if `check`
fails; nothing installs by itself. Spec 1 section 7.9 lists `update/apply` as an `admin`, local
operation answering a job. Spec 4 section 4.2 has `notice.updated` once the new version first
starts, and `notice.updateRolledBack` when the old one was put back, saying the owner's settings and
records are as they were before.

What binds the design:

- An older build refuses a database a newer one migrated (`store.newer_schema`), so a rollback after
  a migration needs the old databases back.
- A backup is sealed to the owner key's public half; opening one needs the owner key code from the
  terminal's hidden prompt for the whole restore ([decision
  0152](0152-a-running-install-restores-a-backup-from-the-cli-between-a-stop-and-a-start.md)).
- A new engine that signed a transaction before its rollback would leave no record of it in old
  databases put back, and the old engine could send the same intent again.
- `binference check` reads the running engine, and an install can already fail checks that have
  nothing to do with the update, such as `plugins.sandbox` or Tailscale.
- Once npm replaced the package's files, the process that runs `update` may load none of them: its
  store workers and imports would mix two versions.
- Windows keeps a loaded native module's files open (decision 0264), and the program loads one.
- npm installs a tarball's outside dependencies from its registry, or from its own cache.
- The one-line installers may install into a prefix of the owner's own, such as `~/.local`, when
  npm's global folder needs root.
- A newer release may move `config.json5` to a newer version, which an older build refuses.
- [Decision
  0348](0348-a-community-plugin-installs-from-npm-by-its-integrity-and-provenance-pinned-by-its-files.md)'s
  verifier reads a version's document, tarball and attestation through the `Http` port and verifies
  the Sigstore bundle offline.
- [Decision
  0353](0353-a-signed-calver-tag-runs-the-release-dry-and-only-a-run-by-hand-publishes-it.md)
  publishes from `.github/workflows/release.yml` of `github.com/bInference-Lab/bInference`.

## Decision

- **Only the terminal updates in v1.** `update/apply` stays unserved, as `backup/restore` is
  (decision 0152): it answers `update.terminal_only`, whose words name `binference update`. Telegram
  and the console show `notice.update` with that command.
- **How it was installed.** The running script's real path decides, as `uninstall` reads it: under
  `<prefix>/lib/node_modules/binference` (`<prefix>\node_modules\binference` on Windows), an npm
  install into that prefix, which the one-liners also make, whatever npm's own global prefix is.
  Every npm run of the update and its rollback names that prefix; none runs with root. The Docker
  image (`BINFERENCE_IMAGE_USER` set) never updates in place: `update` ends `update.image` and tells
  the owner to pull the newer release's image. Any other folder, such as a checkout, ends
  `update.not_npm` and names it. Nothing changes in either case.
- **Windows refuses until the runner exists.** On Windows npm cannot replace the package from the
  process that runs `update`. Once it knows the version, before anything is read or stopped,
  `update` ends `update.windows` with three steps: `binference stop`, `npm install --global
binference@<version>`, `binference start`. `notice.update` names the same steps there. A copy of
  the CLI under `updates/runner/` that would run the update waits for the Windows CI job.
- **One at a time.** `binference update` holds `updates/update.lock` for its whole run: a second
  one ends `update.running`. The OS frees the lock when its process ends, so a killed run leaves
  none.
- **Which version.** `--to <version>`, a stable or beta form of decision 0353, or the newest on
  `updates.channel` (decision 0355); none newer than the running version says so and changes nothing
  (`update.not_newer` for a `--to` that is not newer); `--version` stays the program's own flag.
  `--set` flags go to every start the update makes, as `binference start` takes them, since the
  service is installed again with the flags given.
- **Verify first, with nothing stopped.** The CLI reads the new version and the running version
  through decision 0348's registry reader and verifier, the one each feature uses, and keeps both
  tarballs owner-only in `updates/`. Each must have verified provenance from GitHub Actions whose
  source repository is `github.com/bInference-Lab/bInference` and whose build workflow is that
  repository's `.github/workflows/release.yml` run from the tag `v<version>`. Anything else, no
  provenance included, ends `update.download_failed` with the reason `provenance_failed`; no typed
  name gets past it. Tests reach the registry through the host's `npmRegistry` and verify
  test-signed bundles through the host's `bundleVerifier`, which only tests set; the production
  pins stay as written.
- **Then, in order.** A live intent `executing` refuses it (`intent.executing`), asked of the
  running engine and read again from `engine.sqlite` once it stopped, as `reset` does. `check` runs
  on the running version and keeps its failing check ids. The engine stops as `stop` stops it, and
  how it ran is noted; one running in the foreground of another terminal refuses the update
  (`update.foreground`), since `update` never starts an engine in its own process. Under the engine
  lock, a sealed `before_update` backup (decision 0055), then owner-only copies of the closed
  `engine.sqlite` and `agent.sqlite`, each with its log, and of `config.json5` in
  `updates/rollback/`, with the SHA-256 of each in a list written last. `updates/state.json` records
  `checking` with both versions and the backup's id. The words name `binference update` as the
  step that ends a run that stops part way, and the npm command that puts the old release back.
  npm installs the kept tarball, never a name it resolves again: `npm install --global --prefix
<prefix> --ignore-scripts <tarball>`. The new version's own `binference check --fix` then moves
  `config.json5` to its version after a sealed backup. Each start goes through the new program's
  own `binference start`, the service, never this process; the new version migrates its databases
  at start after its own backup.
- **Locked while it is checked.** While `updates/state.json` says `checking`, or is there and does
  not read, every engine starts locked with the reason `update_checking`, whatever its version: it
  opens no key, signs nothing, runs no order or intent, and sends no `notice.locked`. So nothing it
  does needs a record the old databases lack. It still polls Telegram and takes webhook alerts;
  what came in that window goes with a rollback. The owner accepted the lock, and the pause of auto
  orders, copy and webhook fills for the check, on 2026-11-04.
- **What fails it.** An engine that does not answer as the new version, locked, once `binference
start` returns; a check `--json` that prints nothing readable; or a `fail` check id the new
  version's `check --json`, run as a program of its own, has and the first run did not. A failure
  the install had before does not roll it back. An engine that was stopped stays stopped, and its
  check runs without it; the words say its first start runs the new version's migrations.
- **Pass.** `updates/state.json` records `updated` with the release's notes for owners, and the
  engine stops and starts again through the service. It must answer as the new version, unlocked
  unless the old one was locked too. One that never answers, or stays locked when the old one was
  not, signed nothing, so the record goes back to `checking` and the update rolls back. One that
  answers past the lock may have signed, so its data stays. The engine sends `notice.updated`, or
  `notice.updatedBare`, once, then clears the record.
- **Rollback.** On a clock of its own, 20 minutes, apart from the update's 30: the engine stops; one
  that does not stop in time ends the rollback before anything changes, with the next step. npm
  installs the old version's kept tarball the same way, unless the program on disk is the old one
  already. Under the engine lock, every copy is checked against its SHA-256 and put back as a plain
  file, migrated or not, never opened through a database, which an older build refuses once a newer
  one migrated it: each database's log and index go first, then the copy, and a file the update
  found missing is removed. The record says `rolled_back`, and the engine starts through the service
  when it ran as one; it sends `notice.updateRolledBack` once and clears the record. The owner key is
  never asked: the copies are the files the stopped engine held, never sent anywhere.
- **A stop part way.** The copies and the kept tarballs go only once the record says `updated` or
  `rolled_back`, so the data on disk is the installed version's. A `checking` record outlives a
  crash of `update`: the engine stays locked until `binference update` runs again, from either
  version, and takes the rollback up where it stopped. An old tarball that is gone, an npm that
  fails, an engine that holds the folder or copies that are missing or changed each leave
  everything as it is, the record `checking`, and name the step that ends it; for lost copies, that
  is restoring the sealed backup. A run that stopped after its record was final leaves copies the
  next `update`, the next engine start or `binference reset` removes; `reset` refuses while a record
  says `checking`.

## Consequences

- An update never asks for the owner key, and both of binference's tarballs are on the machine
  before anything stops. binference keeps no copy of their outside dependencies, so a rollback's
  npm run needs npm's registry, or npm's cache holding them, like the update itself.
- No transaction is signed between the new version's start and its verdict, so a rollback never
  forgets one.
- A sealed backup and a plain copy exist for the update's length; the copy is no more readable than
  the live files beside it.
- Each update restarts the engine twice on a pass. In the `manual` unlock mode the owner runs
  `binference unlock` after it, as after any restart.
- The proof installs packed versions into a scratch npm prefix other than npm's own, and a scratch
  state folder, with a stand-in registry on loopback and test-signed provenance; one of them
  migrates the records past the old version, and the rollback puts them back.
- Windows owners update by hand until the runner copy is built.

## Alternatives

- **Restore the sealed backup on rollback.** It needs the owner key code at a terminal for the whole
  restore, and a terminal update would ask for it before it knows whether a migration runs.
- **Roll back on any `fail` finding.** An install that fails `plugins.sandbox` today could never
  update.
- **`npm install --global binference@<version>`.** npm resolves the version again after the check,
  so what installs need not be what was verified.
- **Check the new version with the engine stopped.** `check` then sees no engine, and a version that
  does not start passes.
- **Run the new engine unlocked during its check.** A fill or a confirmed intent could sign in that
  window, and a rollback that puts the old databases back would forget it.
- **Decide whether to put the copies back by opening the databases.** The old build refuses a
  database a newer one migrated, which is the case a rollback exists for.
- **`update/apply` as a one-shot task of the OS service manager.** It would outlive the engine it
  stops, but the owner chose the terminal only for v1.
