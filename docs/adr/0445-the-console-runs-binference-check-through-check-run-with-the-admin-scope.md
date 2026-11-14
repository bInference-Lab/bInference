# 0445. The console runs binference check through check/run, with the admin scope

Status: Accepted

Accepted by the tech lead on 2026-11-14.

## Context

`binference check` runs in the CLI on the engine's machine. Its findings read the config file and
its secret sources, the state folder's permissions, the unlock mode and the model prices; reach
the engine over IPC for its status, its wallets and its orders; run Tailscale's CLI for remote
access; check the plugin sandbox and the shell's wall; and reach outside: `network.proxy` asks the
owner's proxy to reach Telegram, and `models.reachable` makes one small live call to the main
model, which the provider bills. Each finding has a stable check id, a level (`ok`, `warn`,
`fail`, `skip`) and words that name the next step.

[Spec 1, section 7](../specs/protocol.md#section-7) lists `check/run` (`read`, `admin` with `fix`,
a job), and the CLI's `unservedOperations` names it as not built. The console reaches the engine
only through the protocol and reads no file. An MCP client holds `read` and `propose`, the Mini App
`read`, `chat`, `confirm` and `loosen`, and a paired console device every scope. A `read` row would
let an outside AI client make the owner's machine run its checks, read its local paths and
versions, and spend a paid model call.

## Decision

- **Who answers.** The self-hosted composition root serves `check/run`: it runs the same findings
  as `binference check`, in the engine's process on the engine's machine. A finding that reads the
  engine reads its handlers there, with the CLI's scopes, not over IPC, and `engine.reachable` is
  `ok` with the engine's version. A Cloud root leaves the operation unserved, since an install there
  has no machine of its own; the CLI's list of operations a Cloud root leaves unserved says so.
- **Scope.** `admin`, with no `scopeCase`. The console of a paired computer runs it; the Mini App
  says to run the checks there or with `binference check` in the terminal.
- **No fix.** `fix: true` is refused with the new error code `check.terminal_only`, whose words name
  `binference check --fix`: the fix moves `config.json5` only while the engine is stopped, after a
  sealed backup, and changes who can open the state folder's files.
- **A job.** The call answers `{ job }`, and the job ends on the `job` topic with `job/done`, whose
  result is a check report: `{ findings, ranAt }`, each finding `{ check, level, message?, more? }`,
  where a message is `{ key, values }`, a key of the shared i18n `check` area and its values as
  strings and numbers. The findings' details, which only scripts read, stay out. A report holds at
  most 200 findings.
- **Bounds.** One run at a time: a call while one runs answers its job. A run has the CLI's 15
  seconds. A report is kept 60 seconds: a call within them answers a new job that ends at once with
  that report, so repeated taps make no second paid model call and no second request to Telegram.
- **Words.** The CLI and the console read a finding's words from the shared `check` area, the same
  words in both. A report's values are what the terminal shows: the owner's own paths, model and
  provider names, ports and wallet addresses, on the owner's own admin device. No finding holds a
  secret: a test plants a secret value in every source a finding reads and finds it in no report.

## Consequences

- The console gets a Checks screen: each finding's level, words and next step, the summary and
  what the ceiling promises, as the terminal prints them.
- The protocol gains the check report's view and `check.terminal_only`, both additions. The row's
  scope narrows from `read` to `admin` inside protocol v1 and loses its `scopeCase`, which only
  widened who needed `admin`: no engine ever served the row, so no client relies on its scope.
  `check:protocol-compat` accepts a narrower scope only on a row the CLI's `unservedOperations`
  names as not built, fewer callers in some case and more in none, and still refuses narrowing a
  served row, widening any row and any other change to an unbuilt row.
- Spec 1's row, the operations reference and the served-operations list change with it.
- A Cloud console has no Checks screen until Cloud has checks of its own.

## Alternatives

- **Keep `read`.** An MCP client could run the checks, read the machine's paths and spend a paid
  model call on each call. Rejected.
- **Answer the report in the call, not a job.** The row is a job already, and a run takes up to 15
  seconds, past what the console's other calls wait for. Rejected.
- **Redact the report as the support bundle does.** The bundle writes a path as `[path]` and a URL
  as its kind, so `check.open` would no longer name the file to fix, and the owner's own device
  needs no redaction from the owner. Rejected.
- **Allow `fix` from the console.** The config move needs the engine stopped, which the engine
  cannot do for itself and answer, and a change of file permissions belongs to a person at the
  machine. Rejected.
