# 0446. The console reads recent engine log lines through log/recent, kept by the bundle's rules

Status: Accepted

Accepted by the tech lead on 2026-11-14.

## Context

The engine writes one JSON line per log record to its log file on its machine, with a strict set of
fields ([decision 0263](0263-binference-report-writes-a-redacted-support-bundle-in-the-cli.md)).
`binference logs` reads that file in the CLI. [Spec 1, section 7](../specs/protocol.md#section-7)
has `log/follow` and `log/unfollow` (`admin`), which would push new lines on the `admin` topic
`log`; neither is built, and nothing reads lines already written. The console reaches the engine
only through the protocol and reads no file.

Decision 0263 keeps an engine log line in the support bundle only by field rules: the fields the
log line's schema names, each by its own rule, a request's host never, an address cut short, and a
value that breaks its rule as `[omitted]`; a line without the log's JSON shape is counted, never
kept.

## Decision

- **A new operation, `log/recent`**, `admin`, a read: no idempotency key, nothing stored. It takes
  `{ limit?, level? }`, `limit` from 1 to 500 lines (200 when absent) and `level` the lowest level
  kept (`debug` when absent), and answers `{ items, omitted, cut? }`: the newest lines, oldest
  first, each `{ time, level, subsystem, event, fields? }`.
- **What it reads.** The last 1 MiB of the engine's log file, at most 500 lines of it. A missing
  file answers no line.
- **What it keeps.** Each line passes the support bundle's field rules (decision 0263) and nothing
  else, so a request's host is always `[omitted]`. A line without the log's JSON shape is counted in
  `omitted` and never shown. Then the level filter, then the newest `limit` lines.
- **Its size.** The answer holds at most 512 KiB of lines: past it, the oldest go first and `cut`
  is `true`.
- **Who answers.** The self-hosted composition root, which reads the file the engine writes. A
  Cloud root leaves it unserved, since an install there has no log file of its own; the CLI's list
  of operations a Cloud root leaves unserved says so.
- **Not live.** The console reads again when the owner asks. `log/follow` and `log/unfollow` stay
  unserved.

## Consequences

- The console gets a Logs screen: recent lines as the support bundle keeps them, in English as the
  log writes them, with a level filter, the count of lines left out and a reload. A paired
  computer's console reads it; the Mini App, which has no `admin`, says to read the logs there or
  with `binference logs` in the terminal.
- The support bundle and `log/recent` share one reader of the newest lines and its field rules, so
  a new log field needs its rule once, for both.
- The protocol gains the operation and its line view, both additions; spec 1, the operations
  reference and the CLI's list of operations a Cloud root leaves unserved change with it.
- An `admin` client can read which ids, error codes and events the engine logged, never a host, a
  label, chat text or a secret.

## Alternatives

- **Serve `log/follow` with a replay of recent lines.** It needs a store of lines per topic and a
  push per line, and the screen would need a subscription kept open. Later, with live following.
- **`read` scope.** An MCP client could read what the engine did. The `log` topic is `admin`
  already. Rejected.
- **Raw lines with secret patterns masked.** A pattern list misses what it does not know (decision
  0263). Rejected.
- **The whole file, paged.** A long-running engine's file grows past any answer's size, and the
  screen is for what happened lately. Rejected.
