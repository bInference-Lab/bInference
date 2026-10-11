---
name: debug-failure
description: Finds the cause of a failure in a running install, a test or CI by naming the boundary it crosses and reading the signal there before changing code. Use when behavior differs from the spec, a call fails with an error code, or a test passes locally and fails in CI.
---

# Debug a failure

Guessing costs more than looking. Name the boundary where the failure could start, read the
evidence there, then change the one thing that is wrong.

## 1. Name the boundary

Pick the first place where what happened can differ from what should happen:

| Boundary          | Where to look                                                         |
| ----------------- | --------------------------------------------------------------------- |
| Config            | `config.json5`, its layers and issues: `binference check`             |
| Protocol call     | the operation's row in `packages/protocol`, the error code it returns |
| Engine use case   | `packages/engine/src/<feature>/`, its handler in `src/operations/`    |
| Wallet and signer | the wallet queue, the executor, the signer's hard rules               |
| Chain             | RPC answers, the relay, the receipt, the stored raw transaction       |
| Venue             | the plugin's `src/api/` answers and its decoder                       |
| Telegram          | the inbox, the outbox, the throttler, the synthetic Bot API in tests  |
| MCP client        | the tools the client listed, each call's args and the engine's answer |
| Platform          | paths, the keychain, the service manager, IPC, file permissions       |
| CI only           | the OS of the failing job, the runner, the Node version               |

## 2. Read the evidence

On an install, never the owner's real one. Use a state folder of your own:

```sh
export BINFERENCE_HOME="$(mktemp -d)"
binference status
binference health
binference logs --follow
binference check
binference safety status
```

- Logs are JSON lines in `$BINFERENCE_HOME/logs/`, one subsystem per child logger
  (`engine.policy`, `chain-evm.relay`), with ids and error codes, never content. Find the
  `intentId` or `traceId` and follow it.
- An error code is dotted (`quote.venue_down`, `auth.scope`). Search the code for it: one module
  raises it, and the `fail` frame's `retryable` says whether the same call may pass later.
- Stored state is SQLite (`engine.sqlite`, `agent.sqlite`). Copy the file before you read it, and
  open the copy read-only. Never write to the files of a running engine: one engine holds the
  lock, and the ledger is append-only.
- For an intent, read its state and history before its card: the state machine is the one owner
  of what happened.

In a test, read the first failing assertion, then the fake's recorded calls (the synthetic Bot
API's `calls()`, a fake store's rows). A fake that disagrees with its contract suite is a bug in
the fake.

## 3. Compare what is configured with what ran

Many failures are a gap between the two: a venue enabled in config but not installed for lack of
its key, a chain in config whose registry has no such contract, a scope the token lacks, an agent
that is paper while you expected live, a frozen agent. Check the running values, not the file.

## 4. Fix and prove

1. Reproduce with the smallest test that shows the failure. Keep that run.
2. Change the cause, at the module that owns it.
3. Run that test, then its folder, then the neighbors that share the module.
4. For CI only: read the failing job's log for its OS and Node version and run the same test on
   that OS when you can. Never retry a job to get green without a cause.

## 5. Rules while you look

- Never print a secret, a key, a seed phrase or a bot token, and never paste one into a test,
  a log or an issue. Use the test values the fakes give.
- Never point a debug session at a live wallet. Paper mode or a fork.
- Remove any debug output before `clean-diff`. Logging through the `Logger` port stays only when
  it carries ids a person will need again.

## 6. Report

The boundary, the evidence that pinned it (the command with secrets left out, and what it
showed), the fix's location, the test that proves it, and any doubt that remains.
