# 0135. The crash suite kills binference start

Status: Accepted

## Context

[Decision 0129](../DECISIONS.md#d0129) had the crash suite kill an engine composed from the real
executor, with fakes for prices, wallet facts, the simulation and positions, because
`binference start` could not trade live without adapters for them. It said that once the real
adapters were wired in, the suite would kill `binference start` itself. They now are: Chainlink
prices, the wallet facts on the chain, `eth_simulateV1` and the positions in `engine.sqlite`. The
suite's chain is still a bare anvil with BSC's chain id, with no network, and the startup also
reaches Privy and KyberSwap's API, which a crash run cannot reach.

## Decision

- Each run sets up its own state folder as an owner does: `binference init` against a fake Privy,
  with BSC's RPC and relays in config.json5 pointed at the test's chain. The engine process runs
  `binference start` through the same `runCli` as `src/main.ts`; only its outside world is the
  test's: its Http reaches the test's chain, relays, fake Privy and KyberSwap's API on loopback,
  and the signer runs in the process with the agent key the engine hands it, as the end-to-end
  tests start it.
- The test's Privy runs in the test process and keeps its state across the kill. It counts every
  transaction it signs, and at the `signed` kill point it signs and holds its answer while the
  engine is killed.
- The test's KyberSwap API routes every swap through one pool at a fixed rate and encodes
  KyberSwap's router call for the wallet and deadline asked. On the bare chain, the registry's
  USDT and KyberSwap's router are small contracts the test installs: the router pays USDT for the
  BNB sent. The BNB and USDT feeds answer a fresh round at each run.
- The owner goes live, proposes and confirms over IPC, as the CLI would. The second engine stops
  through `engine/stop` once the run's intent has ended.
- Everything else is decision 0129's method: five kill points, the count of what reached the
  chain from the relays and anvil, never from the engine, and one run per kill point by default.

## Consequences

- The crash evidence now covers the startup's wiring of every money part, Privy's signing path
  through the custody adapter, and the engine lock and store reopened by a second
  `binference start`.
- A run takes a few seconds more: `binference init` and two engine starts.
- The routing and the chain's market are fakes the test owns, so the suite still needs no
  network; KyberSwap's own route building is proven on the fork, not here.

## Alternatives

- **Keep decision 0129's composed engine.** The startup code that the release runs would stay
  outside the crash evidence. Rejected.
- **A BSC fork with KyberSwap's public API.** Every run would depend on the network and on
  KyberSwap's answers, and a fork's node keeps old state for about a minute. Rejected.
- **A test hook that hands `binference start` its venues.** A production change made for a test,
  as decision 0129 found. Rejected.
