# 0112. An unknown token needs GoPlus and the round trip

Status: Accepted

## Context

[ARCHITECTURE.md section 7](../ARCHITECTURE.md#section-7) says an unknown token needs a clean
simulation, a clean GoPlus answer and liquidity above a floor, that a hard flag blocks it, and that
it fails closed when the risk sources are down. It does not say which sources a token needs,
which findings map to which of spec 6's risk reasons, whether a sale is checked, or where the
liquidity figure comes from. GoPlus and honeypot.is both answer without a key. honeypot.is's terms
forbid reselling or sharing its API.

## Decision

- The risk step checks only the token a trade buys. A token the chain registry lists, and the
  native coin, pass without asking anyone. A sale passes the risk step; its simulation decides.
- An unknown token needs GoPlus's report and the engine's own round trip (decision 0113).
  honeypot.is is a second opinion: its findings count when it answers, and its outage blocks
  nothing. The self-hosted profile asks both; bInference Cloud asks GoPlus alone, since a hosted
  service would share honeypot.is's API with its users. The composition root wires the sources by
  profile; nothing else learns it.
- Each source answers through the risk cache for `risk.cacheTtlSec`, under a 5-second timeout.
- The intent stores the first of spec 6's risk reasons that holds:
  - `honeypot`: a source reports a honeypot.
  - `cannot_sell`: a source reports a whole sell tax, or the round trip's sale of everything it
    bought finds no route, reverts or pays nothing.
  - `hidden_owner`: a hidden owner who can also change balances. Either one alone is a warning.
  - `high_tax`: the highest tax the round trip measured on any leg is above the agent's maximum.
  - `low_liquidity`: the largest liquidity any answering source reports is below the floor; no
    figure counts as zero.
  - `sources_down`: a required source is down, has no answer or times out, or the round trip
    cannot run.
  - `blacklisted`: GoPlus reports that the contract can blacklist holders, or the round trip's
    transfer to a second fresh account fails.
- Every other finding passes with a warning.

Accepted by the owner on 2026-10-09.

## Consequences

- A token whose contract can blacklist holders never passes, as spec 6 and its message say.
- A token that refuses a sale of a holder's whole balance is blocked as `cannot_sell`.
- A sale of an unknown token is no longer `risk_blocked`; its simulation still runs.
- The risk view the intent stores names each source's findings, and a source that was down.

## Alternatives

- **Require honeypot.is too.** An outage of a second keyless service would block every unknown
  buy, and Cloud could not ask it at all. Rejected.
- **Block on a hidden owner alone.** GoPlus marks many tokens whose owner holds no power over
  balances. Rejected.
- **Check sales too.** A honeypot's holder cannot leave anyway; the simulation already refuses a
  sale that fails. Rejected.
