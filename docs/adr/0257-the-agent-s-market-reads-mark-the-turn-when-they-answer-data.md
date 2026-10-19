# 0257. The agent's market reads mark the turn when they answer data

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Spec 8](../specs/runtime.md) section 5.1 gives the agent three market reads: `market_scan`,
`chart` and `wallet_activity`. Section 5.4 says `market_scan` results always hold outside content
and that every other tool stays clean by showing an unlisted token by its address. It is silent on
`chart` and `wallet_activity`, whose results hold no deployer's words: a chart is numbers from a
market data source, and the engine's `wallet/activity` names only tokens the registry lists.

Numbers can steer a proposal as well as words can. A thin pool's candles are whatever its traders
make them, and a tracked wallet's trades are whatever its owner chooses, such as a buy made to bait
copiers. [Decision 0245](0245-an-alert-fires-once-per-match-tells-the-owner-and-wakes-the-agent-marked.md)
already marks every alert wake-up for this reason: a price or another wallet's trade is a market's
or another wallet's doing.

The engine answers `wallet/activity` for the agent's own wallets with `wallet.not_found` until a
spec decision lets it read their executions.

## Decision

- **Every result with data marks the turn.** A `market_scan` with tokens in it, a `chart` with
  candles and a `wallet_activity` with trades are outside content, whatever the token. The result
  opens with the outside-content line the web tools use.
- **Empty results and refusals stay clean.** "No launch passes the filters", "no trade in that
  span" and every refusal hold only binference's own words, so they mark nothing.
- **Addresses come from the engine.** The three tools hold addresses the engine read, so a
  proposal may take a token's address from them, as from `token_info`
  ([decision 0206](0206-the-engine-labels-each-note-and-a-proposal-never-takes-an-address-from-one.md)). A deployer's
  words are cut to 32 characters (decision 0258), too few to hold an address.
- **The agent's own wallets.** `wallet_activity` passes the engine's `wallet.not_found` on, with
  words telling the model that it reads tracked wallets only and that `portfolio` and `tx_status`
  read the agent's own.

## Consequences

- A turn that charted any token, even the chain's coin, proposes only to a card that carries the
  warning, until the owner clears the session. Auto mode fills nothing after a market read. The
  owner confirmed this trade-off on 2026-10-20.
- Section 5.4 of spec 8 lists `chart` and `wallet_activity` beside `market_scan`.

## Alternatives

- **Mark only results that hold a deployer's words.** A chart or a leader's trades would leave the
  turn clean while they carry what a stranger chose to show. Rejected: money fails closed.
- **Mark a chart only for a token the registry does not list.** Each chart would need an extra
  `asset/get`, and a listed token's thin pool can still be pushed. Rejected for one rule per tool.
