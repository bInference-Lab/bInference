# 0459. The engine warns on memory past 512 MB

Status: Accepted

Accepted by the lead on 2026-11-27.

## Context

The `memory` health signal reads the engine process's resident memory: ok under 300 MB, warn
under 1 GB, fail past it. The 300 MB line is the idle target ARCHITECTURE section 24 set before the
engine was built; no measurement stands behind it. Since then the engine process has come to hold
the protocol server, the money path, the Telegram bot, the agent runtime's supervisor, the plugin
host, the browser and PDF drivers, and the store's worker threads. An installed engine idles at
375 MB, peaks at 443 MB, shows no leak over 20 minutes, and reads 491 MB after a day running, so
the signal reads warn on every healthy install and says nothing. Loading the `binference` command
alone, with no engine started, leaves 110 MB on its heap.

Measured on a fresh paper install with the fake Privy, the synthetic Bot API and a scripted model,
paired, idle for three minutes, two runs, after Playwright loads at the browser's first start
instead of with the engine:

| Part                                                                  | Idle             |
| --------------------------------------------------------------------- | ---------------- |
| Main thread's heap, nearly all of it the code of the packages it runs | 100 to 108 MB    |
| engine.sqlite writer and reader workers, each its own heap            | 34 to 40 MB each |
| Telegram's poll worker                                                | 16 to 17 MB      |
| Node itself, with no code loaded                                      | 50 MB            |
| Native memory: SQLite caches, compiled code, buffers                  | the rest         |
| Resident in all                                                       | 341 to 348 MB    |

In the first 100 seconds each store worker holds 64 to 81 MB, until V8 gives back what the start
left, so the engine reads 460 to 470 MB then. Each worker is its own V8 isolate and loads its own
copy of the store's code (Kysely, zod, the protocol's schemas, the task definitions), about 27 MB
of it. Before the Playwright change the engine settled at 388 to 404 MB.

The engine's own code cannot shrink much without moving parts out of the process or dropping the
store's reader, which the store's rules keep: one writer per database and reads on readers. On a
machine with 1 GB, the engine at 345 MB, the agent runtime at 185 to 210 MB and the signer at
68 MB fit together.

## Decision

- The `memory` signal reads ok under 512 MB, warn under 1 GB, and fail past 1 GB.
- ARCHITECTURE section 24's target for an idle engine is under 400 MB.
- Code the engine runs only on a request, such as a browser library, loads at its first use, not
  at the start.

## Consequences

- A healthy engine reads ok while it starts, while it idles and after a day running; warn now
  points at growth, such as a leak or a cache without a bound.
- The 1 GB fail line, and the target of running on one vCPU and 1 GB, stay.
- An engine that grows from 345 MB to near 512 MB reads ok throughout; only the trend in its logs
  shows it.

## Alternatives

- **Keep 300 MB.** Every healthy engine reads warn, so the owner learns to ignore the signal.
- **One store worker for engine.sqlite, reads and writes together.** Saves about 35 MB, but a read
  waits behind each write, against the store's rule of reads on readers.
- **Warn at 400 MB.** The start's 470 MB and an engine with a day of use read warn, so the signal
  stays noisy.
- **Load each command's code only when it runs.** The terminal chat and the MCP server add 0.3 MB
  and 4 MB to the engine's heap; the rest of the code the engine needs.
