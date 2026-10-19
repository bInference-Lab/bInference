# 0254. A launchpad reads its launches from their transaction's logs

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

The launch feed records each token a launchpad creates ([spec 3](../specs/database.md) section
2.6, `launches`) and shows it as a `LaunchView` ([spec 1](../specs/protocol.md) section 8.3): its
creator, quote token, tax, snipe tax, curve progress, graduation and insiders. The specs say each
launchpad plugin decodes its create event, but not where the other facts come from. The facts:

- Flap's docs ("Index Token Created Events", read on 2026-10-19) tell indexers to read
  `TokenCreated` on the Portal and enrich it with the Portal's other events in the same
  transaction: `TokenQuoteSet` (missing means the chain's coin) and `FlapTokenTaxSet`, which
  carries the higher of the buy and sell tax in basis points (missing means none).
  `FlapTokenProgressChanged` carries the Portal's progress, 0 to 10^18 for a full curve, and
  `LaunchedToDEX` the move to a pool. Every Flap token has 18 decimals.
- A Genius.fun factory writes `TokenLaunched(token, curve, deployer, pairToken, launchConfigId,
graduationThreshold)`; the deployer is the launching wallet even when the launch goes through
  Genius.fun's router. The launch's own curve writes `SnipeTaxExempted(account)` for each wallet
  the launch exempts, in the same transaction. The creator tax, the launch's phase, the snipe tax
  and the curve's place are no event's: they are reads of the factory and the curve.
- Public nodes prune state within about a minute
  ([decision 0252](0252-log-queries-go-to-48-club-s-public-node-until-the-owner-names-an-rpc.md)),
  while log queries reach far back. A feed that resumes after an outage can read old logs, but not
  the state at old blocks.
- Anyone can write any event. A log is only as good as the contract that wrote it.
- four.meme and Brew launches come later; their plugins add the same part.

## Decision

- **A plugin part.** A launchpad whose launches the feed records declares `launchEvents`, the
  event ids it needs (an EVM event's topic0), and `readLaunches`, which turns one transaction's
  logs into the launches it created and the curve changes it tells. It reads the logs alone and
  never throws on a log outside its shape. The `launchReaderContract` suite holds each plugin to
  it. A plugin that declares one without the other fails when it loads.
- **Who wrote it.** A create event counts only from the launchpad's registry contracts (Flap's
  Portal, a listed Genius.fun stack's factory). A fact from a contract the launch made, such as a
  Genius.fun curve's exemptions, counts only from the contract the create event named in the same
  transaction.
- **What the logs say first.** Each launch carries what its transaction's logs tell. Insiders are
  the wallets the launch exempted from a launch-window tax, and the wallets that bought in the
  launch's own transaction.
- **Reads complete it.** For a fact no log carries, the plugin names read calls with a pure step
  over their answers, as a price read does. The feed asks every launch's calls of one read in one
  Multicall3 call at the latest block: a fact as last read. An answer that failed leaves its fact
  out, never the launch.
- **Later logs.** Logs after a launch that move its curve or graduate it update the stored launch
  in place.
- **Flap** reads `TokenCreated` (token, creator, name, symbol), `TokenQuoteSet`, `FlapTokenTaxSet`,
  `TokenBought` in the same transaction for insiders, and `FlapTokenProgressChanged` and
  `LaunchedToDEX` for the curve, then and later. Its tokens have 18 decimals and no snipe tax.
- **Genius.fun** reads `TokenLaunched` (token, curve, creator, quote token), the curve's
  `SnipeTaxExempted` for insiders, and `PoolGraduated` and `LaunchSwept` for graduation. Its reads
  are the factory's record of the launch (creator tax, phase), the factory's starting snipe tax,
  the curve's token reserve and its sellable tokens (progress: tokens sold over tokens sold plus
  sellable), and the token's name and symbol. Its tokens have 18 decimals.

## Consequences

- `Venue` gains the optional `LaunchReader` part; `@binference/plugin-sdk` exports it and its
  contract suite. four.meme and Brew each add `launchEvents` and `readLaunches`.
- A resumed feed records the same launches with the same log facts as a live one; read facts are
  the state when the feed read them.
- A Genius.fun launch's curve progress moves only when a later read asks; Flap's follows each
  trade's log.

## Alternatives

- **Read the state of each launch at its block.** Public nodes keep under a minute of state, so a
  resumed feed would lose the facts. Rejected.
- **Read each launch transaction's receipt.** One call per launch, unbounded in a busy block, for
  logs one query already returns. Rejected.
- **Facts from the logs alone.** Genius.fun's creator tax and snipe tax would stay unknown, and a
  launch filter's bound on them never passes. Rejected.
