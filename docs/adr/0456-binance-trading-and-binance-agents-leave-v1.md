# 0456. Binance trading and Binance agents leave v1

Status: Accepted

Accepted by the owner on 2026-11-27.

Amends [decision 0006](../DECISIONS.md#d0006), [decision 0012](../DECISIONS.md#d0012),
[decision 0080](../DECISIONS.md#d0080) and
[decision 0355](0355-the-update-check-reads-npm-and-opt-in-counts-go-to-binference-io.md).

## Context

Decision 0006 puts CEX trading in v1 through a Binance Agent OS plugin, decision 0012 counts CEX
in v1's scope, and decision 0080 adds Binance Agents: connecting and managing the agents an owner
runs on Binance Agent OS. Both need Binance to accept binference as a client first (ARCHITECTURE
sections 15 and 29). Binance gave no partner answer before the first release, and none of it is
built: the nine `binanceAgent/*` and three `cex/*` operations are unserved, the plugin does not
exist, and spec 7 was never written. binference ships what it can prove.

## Decision

The owner's decision: Binance trading and Binance agents are not in v1.

- No Binance Agent OS plugin, no `cex_*` tools, no Binance agents, no spec 7.
- The config key `cex` (`cex.binance.enabled`) goes. Config version 25 removes it from an older
  file, and nothing reads it.
- The `binanceAgent/*` and `cex/*` operations stay in the v1 protocol table, which never drops a
  row. The engine leaves them unserved with the reason `out_of_v1`, which names this decision, so
  a call fails with `protocol.unknown_op`.
- The engine refuses a `cexOrder` request with `intent.kind_unavailable` before it stores
  anything, as it refuses a `lend` (decision 0296); the request keeps its v1 shape.
- The notices `notice.binanceRefused` and `notice.binancePaused`, which nothing sent, go.
- The opt-in counts of decision 0355 keep their `plugins` field, which stays empty: no bundled
  plugin is turned on by the config.

## Consequences

- An owner who wants an agent on Binance runs Binance's own MCP server in their own MCP client,
  beside binference's MCP server.
- The `cexOrder` intent kind, its card line and the empty `cex_connections` table stay, since the
  protocol and the stored schema never drop what they shipped; no `cexOrder` intent is ever
  stored.
- Binance trading or Binance agents come back only through a new decision, with their own config
  migration.

## Alternatives

- Keep them in v1 and wait for Binance: the release would wait on an answer that has no date.
- Keep the config key and the notices for later: words and settings that do nothing mislead the
  owner.
