# 0463. A new agent may use Relay and goes live before it has a bridge wallet

Status: Accepted

Accepted by the lead on 2026-11-28. Proposed on the owner's ruling of 2026-11-28: "remove that safety rule for bridges, make it
enabled by default".

## Context

[Decision 0461](0461-a-new-agent-bridges-with-across-from-its-first-wallet.md) made Across a core
venue and left Relay out, because under
[decision 0307](0307-a-bridge-wallet-holds-only-its-own-deposits-and-runs-every-route-only-it-may-pay.md)
`agent/goLive` answers `limit.needs_bridge_wallet` while the agent's venues name a venue only a
bridge wallet uses and it has no live bridge wallet; `limit/set` refuses such a venue for a live
agent with the same code. Every new agent naming Relay could then not go live until the owner made
a bridge wallet, which most owners never do.

That rule guards nothing the money path does not: a bridge whose routes only a bridge wallet takes
is refused before anything is stored, with `intent.bridge_wallet_missing`, whose words name
`binference wallet create --bridge`. No main wallet's ceiling holds a Relay deposit, so a main
wallet can never make one.

## Decision

- Relay is a core venue. A new agent's venues name `relay` beside `across`; `init` and the rebuild
  take it from Relay's own declaration. Its deposits are a bridge wallet's alone, so the first
  wallet's ceiling holds none of them and no spender of Relay.
- `agent/goLive` and `limit/set` no longer refuse a venue only a bridge wallet uses because the
  agent has no live bridge wallet. Once it has one, they still refuse it with
  `limit.bridge_ceiling` while that wallet's ceiling lacks one of the venue's calls, which only the
  owner key adds.
- A bridge through such a venue keeps its refusal before any card,
  `intent.bridge_wallet_missing`, until the owner makes and funds a bridge wallet.
- An address saved on a chain such a bridge reaches, which the agent's venues name, is no
  `noRoute` entry: Relay's deposit names no recipient, so no ceiling rule ever lists it, and the
  bridge wallet pays it (decisions 0307 and 0313). `address/add` answers that only a bridge to the
  chain pays it, and `address/list` leaves it unmarked.
- The engine no longer answers `limit.needs_bridge_wallet`. The code and its words stay in the
  protocol for clients of older engines.

## Consequences

- A new agent goes live without a bridge wallet, bridges with Across at once, and with Relay once
  the owner makes a bridge wallet with `binference wallet create --bridge` and funds it.
- What a stolen engine key gains: nothing. Relay's deposits sign only from the bridge wallet,
  whose ceiling the owner key writes, and only with what the owner put in it.
- An agent made before this release keeps its venues; the owner adds `relay` with `limit set`,
  which applies at once under decision 0462.
- Decision 0461's alternative "Relay listed, and going live no longer refusing a bridge-only venue
  without its wallet" is the one taken now.

## Alternatives

- **Keep Relay out of the core venues.** Against the owner's ruling: bridges to Solana and USDG on
  Robinhood Chain, which only Relay serves, stay off for every new agent.
- **List Relay and keep the go-live refusal.** Every new agent then cannot go live until it has a
  bridge wallet, as decision 0461 found.
- **Make a bridge wallet at init.** It costs a Privy wallet and a ceiling for every owner, funded
  from outside or left empty, for a bridge most owners never make.
