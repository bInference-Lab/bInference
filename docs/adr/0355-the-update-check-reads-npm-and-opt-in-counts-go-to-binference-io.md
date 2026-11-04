# 0355. The update check reads npm, and opt-in counts go to binference.io

Status: Accepted

Accepted by the owner on 2026-11-04.

## Context

[Decision 0047](../DECISIONS.md#d0047) and ARCHITECTURE section 24 set a daily update check, on by
default (`updates.check`), that sends the version, the OS, the Node version and the CPU type, and a
note with the release's changes. [Decision 0048](../DECISIONS.md#d0048) adds opt-in counts to that
check when `telemetry.enabled` is on: the version, the OS, the enabled venues and plugins, paper or
live, and the number of agents, never addresses, balances, amounts, tokens, chats or keys; the
totals are published. Spec 1 section 7.9 gives `update/check` the answer
`{ current, latest?, channel, notes?, releaseNotes? }`, and spec 4 section 4.2 asks for at most 5
lines of at most 200 characters in each language, written for owners and never commit subjects,
with `notice.update` once per version and channel. No spec names where the check asks, what the
answer looks like, how a channel maps to a version, or where the counts go.

[Decision 0353](0353-a-signed-calver-tag-runs-the-release-dry-and-only-a-run-by-hand-publishes-it.md)
publishes a stable release to npm's `latest` dist-tag and a beta to `beta`, through trusted
publishing with provenance. npm's registry answers `GET /-/package/<name>/dist-tags` with
`{ "latest": "...", "beta": "..." }`, and `GET /<name>/<version>` with that version's manifest,
fields of the package's own included. binference.io does not exist yet, and decision 0353's release
notes are commit subjects, which spec 4 refuses for the owner.
[Decision 0348](0348-a-community-plugin-installs-from-npm-by-its-integrity-and-provenance-pinned-by-its-files.md)
already reads `https://registry.npmjs.org` through the outbound `Http` port, with the host's
`npmRegistry` as the test seam. The outbound adapter names every request
`user-agent: binference/<version>` in place of any user agent the caller set.

## Decision

- **The version comes from npm.** The check reads `GET /-/package/binference/dist-tags` on
  `https://registry.npmjs.org`, 10 seconds, at most 16 KiB. On `stable` the latest version is
  `latest`; on `beta` it is the newer of `beta` and `latest` by SemVer, so a beta owner also gets a
  newer stable. A version that is not a stable or beta form of decision 0353, or not newer than the
  running one, is no update.
- **The notes ride in the package.** Each release's notes are two files the maintainer writes,
  `release/notes/<version>.en.json` and `release/notes/<version>.zh.json`, each a JSON list of 1
  to 5 lines of 1 to 200 characters; the style guard keeps Chinese text in a file named `zh`.
  `pnpm release:dry` refuses a stable or beta release without both files, or with lines out of
  those bounds or that the style guard refuses, and the `release` skill says to write them first;
  the first release writes them too. The dry run packs the notes into the `binference` package's
  `package.json` as `binference.releaseNotes`, `{ "en": [...], "zh": [...] }`. The check reads them from
  `GET /binference/<version>`, 10 seconds, at most 1 MiB, only for a version newer than the
  running one. A version without them, or whose lines break the bounds, has none.
- **What the check sends.** The request line and a `user-agent` of
  `binference/<version> node/<node version> <os> <cpu>`, such as
  `binference/2026.11.0 node/v26.10.0 darwin arm64`; no cookie, no install id, no query, no body.
  The outbound adapter keeps a caller's user agent that starts with its own followed by a space,
  and puts its own in place of any other, so no caller can drop the `binference/<version>` name.
- **When.** While the engine serves, a first check a random 5 to 65 minutes after its start, then
  every 24 hours, each time only while `updates.check` is on, read at that time. A locked engine
  checks too. A failed check is logged as `update.check_failed` with its reason, and the next one
  comes at its time; it never raises a notice.
- **The notice.** The first check that sees a version on a channel raises `notice.update` with the
  notes in `owner.locale` as `{summary}`, one line each, or `notice.updateBare` when the release
  has none in that language. `updates/announced.json` in the state folder, owner-only, keeps the
  channel and version announced last, so a restart does not announce it again.
- **`update/check`** (`read`) reads npm at once, whatever `updates.check` says, since the owner
  asked; it changes no record and raises no notice. `notes` is the lines in `owner.locale` joined
  by line feeds, and `releaseNotes` both lists. The protocol's result gains the optional
  `releaseNotes` field spec 1 already names. A registry it cannot read is
  `update.registry_unreachable`, retryable.
- **The counts go to binference.io.** With `telemetry.enabled` on at the time of a daily check, the
  engine posts one JSON body to `https://binference.io/api/v1/counts`, 10 seconds, after the
  version check, whatever its outcome:
  `{ "version", "os", "venues": [...], "plugins": [...], "communityPlugins", "mode", "agents" }`.
  `agents` is the number of agents not archived; `mode` is `paper`, `live` or `both` across them,
  `paper` when none is live; `venues` the venues their limits name, sorted, each once; `plugins`
  the bundled plugins the config turns on (`binance` while `cex.binance.enabled`);
  `communityPlugins` the number of community plugins on in the plugin lock, never their names,
  since a private plugin's name could name its owner. Nothing else goes, no install id either, so
  the totals count checks, not installs. The request carries the same user agent as the check.
  Every failure is logged at `debug` and dropped: telemetry fails soft. With telemetry off no
  count is sent.
- **Every request** goes through the engine's outbound `Http` port, so the owner's proxy applies
  ([decision 0347](0347-every-outbound-request-goes-through-the-owner-s-proxy-and-none-goes-around-it.md)).
  Tests point the registry at a loopback stand-in through the host's `npmRegistry`, and the counts
  through the host's `countsUrl`, which only tests set; no config key is added.

## Consequences

- The check works the day the first release is on npm, without hosting. The counts have nowhere to
  go until binference.io serves `/api/v1/counts`; until then each opted-in check logs one `debug`
  line.
- npm, not binference, sees each check's IP address and user agent, so binference learns nothing
  of the versions in use until the counts' endpoint exists.
- Every stable or beta release needs its notes file in both languages before its dry run.
- `disclaimer.privacy` already says the update check sends the version and OS.

## Alternatives

- **A JSON feed on binference.io**, `GET /api/v1/updates/<channel>` answering
  `{ version, releaseNotes }`, with the counts in the same request. One host for both, and
  binference sees the version spread. It needs hosting before the first release, and the version
  could disagree with what npm serves.
- **GitHub releases.** The API is rate limited to 60 an hour per IP address without a token, and a
  release's body is commit subjects.
- **Config keys for the two addresses** (`updates.url`, `telemetry.url`). Each needs a config
  migration, and a mirror of npm's registry is already a later change (decision 0348).
- **An install id with the counts.** Totals by install would be exact, but a stable id across
  days is more than decision 0048 lists.
- **The record of the version announced in `engine.sqlite`'s `meta`.** It needs a store port, its
  contract suite and its fake for one value the engine alone reads.
