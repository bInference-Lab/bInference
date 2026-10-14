# 0212. A launch's own contracts come from its launchpad's curve read

Status: Accepted

Accepted by the owner on 2026-10-14.

## Context

[Rule 10](../ARCHITECTURE.md#rule-10) says contract addresses come only from the registry. The
venue host gives a venue its registry contracts by name, and refuses a trade call, an approval's
spender or a price read to any other contract.

Genius.fun deploys a curve contract for each launch. A curve trades only its own token: `buy` and
`sell` on the curve, a sale after an approval of the curve. The stack's factory names each curve
(`getLaunchedToken(token)`); its router only launches tokens. No fixed contract trades a launched
token: the contract ABIs genius.fun ships, 2.0.0 to 4.2.0, read on 2026-10-14, have none. A
registry checked by hand cannot list a contract made with each launch.

[Decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md) makes the wallet's ceiling
list, per function, the contracts it may call, at most 100, and the spenders an approval may name.

## Decision

- **A venue declares a launch's contracts by name.** Per chain, `launchContracts` names the
  contracts each launch has, such as `curve`. The names differ from its registry names. Its calls
  and spenders may name them.
- **The launchpad's curve read gives their addresses.** For a token it holds, the curve read names
  them (`launch`), read through the launchpad's registry contracts at the latest block, such as a
  stack's factory. The host takes a claim only under names the venue declares, on the token's
  chain; any other is `venue_down`.
- **For that token's trades and price reads alone.** When a launchpad declaring them quotes, the
  host asks its curve read about the token bought, then the token sold, never the chain's coin, and
  adds the launch's contracts to that request. The quote keeps them for the build. The price read
  of a token a launchpad holds may call them.
- **Every other check holds:** the trade call goes to a declared contract, registry or launch; the
  recipient, the exact input, the minimum out and the exact approval; then the simulation.
- **No agent wallet's ceiling lists them.** A ceiling cannot list a contract made per launch, so
  calls and approvals on launch contracts add nothing to it, and the agent wallets' ceilings keep to
  registry contracts. Live trades on launch contracts will go through a launch wallet of their own,
  a small one the owner funds, whose ceiling may allow them; a later decision builds it.
- **Until then, paper only.** A paper agent may add a venue that declares launch contracts, with no
  ceiling to check. A live agent may not (`limit.needs_launch_wallet`, which no ceiling change
  clears), and an agent whose venues hold one cannot go live. Init never gives one to a new agent.

## Consequences

- A launchpad with a curve per launch quotes, builds, decodes and prices in the engine. A paper
  agent that adds it trades on those curves, through the risk step's round trip and the
  simulation; no live agent can add it, and live trades on those curves are refused at signing.
- The host trusts the launchpad's read for a curve's address, as it trusts the same read for
  whether the launchpad holds a token ([decision 0179](0179-a-buy-or-sell-goes-nowhere-while-its-place-is-in-doubt.md)).
  A wrong address still meets the recipient, amount and approval checks and the simulation.
- `VenueContracts` gains `launchContracts`, `CurveHolding` gains `launch`, and the host's
  `TradeQuote` keeps the launch it quoted with.

## Alternatives

- **List each curve in the registry.** A launch can come at any time, and each address would need
  a release. Rejected.
- **Trade through a contract of ours that calls the curve.** A new contract on the money path,
  rejected for the same reason as in [decision 0180](0180-a-curve-call-with-no-deadline-is-bound-by-its-minimum-out.md).
- **The host reads the factory itself.** The engine holds no chain reads and no venue ABI; it would
  need a declared lookup call and a decoder in each family. Rejected for now: the launchpad's read
  already decides where a token trades.
- **Let the ceiling allow the curve's functions on any contract.** It breaks decision 0149's
  promise for every approval. Rejected by the owner: the launch wallet holds that risk apart.
