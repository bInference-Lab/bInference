# 0258. The agent's market reads answer compact pages that fit a result

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Spec 8](../specs/runtime.md) section 5.2 cuts a tool's result at 12,000 characters. The engine's
market operations page for every client: `market/scan` answers up to 50 tokens, `market/chart` up
to 500 candles and `wallet/activity` up to 200 trades, as JSON with an asset map and long field
names. As JSON, 100 candles alone pass 15,000 characters, so a default chart would reach the model
cut, and every token of a page costs the agent's budget. A deployer's name and symbol have no
length limit, and they reach the model in `market_scan`.

## Decision

- **Page sizes.** `market_scan` asks for 10 tokens unless the model asks for up to 20; `chart` for
  60 candles, up to 100; `wallet_activity` for 10 trades, up to 15, with the engine's cursor for the
  next page. A test proves the largest page of each, every figure at the most digits it takes in
  practice, fits 12,000 characters uncut.
- **Lines.** Each result opens with a line saying what it holds and in which units. A token or a
  trade is one JSON line; a chart is a header row and one comma-separated row per candle (`at`,
  open, high, low, close, volume). Times are ISO 8601 in UTC to the second. Figures keep the
  protocol's units: base units, micro-dollars, prices for 10^`priceScale` tokens
  ([decision 0184](0184-market-scans-and-charts-keep-cheap-prices-readable.md)).
- **Fields.** A scanned token carries its symbol, name and `verified` beside its figures, and a
  fresh risk check as its verdict, its flag codes and its taxes; `token_risk` reads the rest. A
  trade drops its block, which its transaction names; the trades' assets follow as one map of
  symbol, decimals and `verified`.
- **A deployer's words.** Control and format characters read as spaces, and a word longer than 32
  characters is cut to 31 and an ellipsis. No word can hold a 42-character address or a line break.
- **Filters.** `market_scan` takes the launch filter without `minLiquidityUsdMicros`, which no
  launch the feed reads passes, and refuses `filters` with `source: trending` before the engine.

## Consequences

- A model that wants more reads the next page or a later span; nothing reaches it cut mid-line.
- The protocol exports the fields the agent's market tools build their terms from
  (`marketTermFields`), so the runtime parses chains, tokens, accounts and launch filters as the
  engine does.
- A new figure in a scan item or a trade joins the line only with a fresh size test.

## Alternatives

- **Answer the engine's JSON, as the other read tools do.** A default chart would be cut and a
  page of trades would repeat every asset id twice. Rejected for token cost.
- **Show amounts in whole tokens.** Proposals take base units, and the protocol's other reads show
  base units; a second unit would invite mistakes. Rejected.
- **Let the engine's page sizes through.** Large pages would be cut at 12,000 characters, losing
  their last items without the model knowing which. Rejected.
