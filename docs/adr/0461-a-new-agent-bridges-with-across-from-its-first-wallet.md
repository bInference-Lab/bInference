# 0461. A new agent bridges with Across from its first wallet

Status: Accepted

Accepted by the lead on 2026-11-28, on the owner's ruling.

## Context

The owner ruled on 2026-11-28: "Bridges should be active ASAP, enabled by default on agent."
Today `init` plans the first wallet's ceiling from the core venues: KyberSwap, the Flap launchpad, StakeHub and
Lista, and OKX with its key. Neither bridge is among them, so the agent's venues lack them and the
ceiling holds no Across deposit. To bridge, the owner runs `binference ceiling set` with the owner
key, then `binference limit set limits.venues=...`, and waits 24 hours, since adding a venue
loosens the limits (decision 0111).

Across deposits from main wallets: each deposit's depositor, recipient, destination chain and
tokens are bound in one rule per destination chain (decision 0302), and it pays only addresses
saved for that chain (decision 0313) and the rescue address where it may (decisions 0318 and
0321). Relay deposits only from a bridge wallet the owner makes and funds from outside (decision
0307). Under decision 0307 an agent whose venues name Relay cannot go live without a live bridge
wallet: `agent/goLive` answers `limit.needs_bridge_wallet`. A new agent from `init --yes` with
Relay listed answers that, where one without it goes on to the funded check.

## Decision

- Across is a core venue. A new agent's venues name `across`, and its first wallet's ceiling holds
  Across's deposit for each EVM chain its routes reach, with the SpokePool as a spender. `init`
  and the rebuild take it from the same declaration the running engine plans ceilings from.
- Relay stays out of the core venues. The owner adds it as today: makes the bridge wallet with the
  owner key, funds it, then adds `relay` to the agent's venues.
- An agent made before this release keeps its ceiling and its venues: only the owner key changes
  a ceiling, so the guide keeps the commands that add Across.

## Consequences

- A new agent bridges with Across once the owner saves an address on the destination chain,
  with no ceiling change and no 24-hour wait for the venue.
- What a stolen engine key gains: Across deposits pay only addresses saved for their chain, and
  the rescue address where decisions 0318 and 0321 allow. At `init` no address is saved, so the
  first ceiling holds no bridge rule that pays anyone; its approval rule may name the SpokePool,
  which moves nothing without a deposit rule. Each saved address is added with the owner key.
- A rebuilt install's agent names `across` too, while the wallets it adopts keep the ceiling they
  hold; a bridge from one without Across's rule is refused before its card with
  `bridge_chain_unpaid`, and the owner adds Across with `ceiling set` as an older agent does.
- Relay still takes the bridge wallet and its 24-hour wait.

## Alternatives

- **Across and Relay both.** Listing Relay at `init` saves its 24-hour wait later, but every new
  agent then cannot go live until it has a bridge wallet, which most owners never make.
- **Relay listed, and going live no longer refusing a bridge-only venue without its wallet.**
  Relay's bridges are refused before any card while there is no bridge wallet, so this would be
  safe, but it changes decision 0307's go-live rule in the engine for a wait of 24 hours.
- **Keep both off.** Against the owner's ruling: every owner runs three commands and waits a day
  before the first bridge.
