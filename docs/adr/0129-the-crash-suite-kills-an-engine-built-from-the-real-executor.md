# 0129. The crash suite kills an engine built from the real executor

Status: Accepted

## Context

The release test for crash safety asks that a forced stop never sends a transaction twice,
across 100 runs on each OS. A forced stop has to land between signing and the send, and between the send and the
receipt, and a second engine has to recover on the same state folder. `binference start` cannot
run a live trade yet: the self-hosted startup still has no adapters for prices, wallet facts, the
simulation or positions, so every live intent stops before it signs.

## Decision

- Until `binference start` can trade live, the crash suite runs `crash-engine.ts`: it opens the
  state folder in `binference start`'s order (lock, config, log, `engine.sqlite`), composes the
  real executor and wallet queue with `composeExecutor`, and recovers, then takes the confirmed
  intents, in the same order as startup. Custody is a test key; prices, wallet facts, the
  simulation and positions are fakes.
- Each run kills that process with the platform's kill (SIGKILL, or TerminateProcess on Windows) at
  one of five points (signed, stored, relayed, sent, included), checks where the kill landed, starts
  a second engine on the same folder, and counts what reached the chain: at most one distinct
  transaction per run, every one of them mined once, nothing left in the pool, and no signature
  after the restart.
- The chain is a bare anvil with BSC's chain id behind two counting relays, so the suite needs no
  network and no fork.
- One run per kill point by default; the nightly `crash` workflow runs 20 per point, 100 per OS.
- Once the real adapters are wired into `binference start`, the suite kills `binference start`
  itself, and this record is amended.

## Consequences

- The crash-safety evidence covers the executor, the wallet queue, SQLite durability under a hard kill, the EVM
  sending path and recovery. It does not yet cover the startup code's wiring of those parts or the
  Privy custody path.
- A bug in the fakes cannot hide a double send: the count comes from the chain and the relays,
  never from the engine.

## Alternatives

- **Wait for the adapters.** Crash safety would have no evidence until the engine can trade
  live. Rejected.
- **A test hook on the CLI host to inject the four parts into `binference start`.** A production
  change made for a test. Rejected.
