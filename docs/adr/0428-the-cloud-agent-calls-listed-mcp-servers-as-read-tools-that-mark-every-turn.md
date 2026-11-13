# 0428. The Cloud agent calls listed MCP servers as read tools that mark every turn

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

The owner decided on 2026-11-05 that bInference Cloud agents get outside MCP servers from a store
bInference reviews, called as read tools whose answers mark the turn as outside content, with auto
mode off as for community plugins. The client is Cloud only in v1: the self-hosted composition
root passes no servers. No listing needs a user's own key or account in v1. The listing catalog
writes and signs the reviewed listings; this decision says what the agent runtime does with them.

A listed server is a third party. Its answers can carry planted instructions; after its review it
can change its tools, flood, stall, or pull data out through the arguments the agent sends.
[Rule 13](../ARCHITECTURE.md#rule-13) marks every turn that read outside content.
[Decision 0350](0350-a-turn-that-offers-a-community-plugin-s-tools-counts-as-outside-content-from-its-start.md)
marks every turn that offers a community plugin's tools from its start and keeps auto mode asking
meanwhile, since a tool's words reach the model before any call. The agent runtime already reaches
the network for model calls, search and `read_page` through its own outbound HTTP, and holds no
key and no `confirm` scope ([spec 8, section 2.1](../specs/runtime.md#section-2-1)).

## Decision

- **The port.** `ListedMcpSource` of `@binference/runtime`: `current()` answers the MCP listings
  in force for the install, each with the agents that have it on, and `watch(listener)` calls back
  after each change. The Cloud composition root fills it from the signed catalog and each agent's
  switches. The self-hosted root passes none, so no settings carry a listing and no agent gets a
  listed tool. `@binference/runtime/testing` holds an in-memory fake. A listing's shape is
  [decision 0429](0429-a-listed-mcp-tool-runs-only-as-its-listing-pins-it.md)'s.
- **Where the client runs.** In the agent runtime, in `src/listed-mcp/`, the only folder that may
  import the MCP client package. The engine never connects to a listed server. The composition
  root checks each listing with the runtime's listing schema before it sends settings, and leaves
  out one that fails, logging `runtime.listing_refused` with the listing's id and the reason, so a
  bad listing never ends the runtime.
- **The package.** The official SDK's client, `@modelcontextprotocol/client` 2.3.0 (Apache-2.0),
  the version the catalog pins beside `@modelcontextprotocol/server` 2.3.0; the two move together
  in one `build(deps)` commit. Its Streamable HTTP client transport is the one transport: no
  standard input transport, no SSE transport, no OAuth.
- **Settings.** The runtime's settings gain `listedMcp`: each listing in force with the ids of the
  agents that have it on, at most 64 listings and at most 4 per agent. The composition root sends
  new settings at each change of `current()`, as it does for plugins
  ([decision 0349](0349-the-agent-calls-a-community-plugin-s-tools-through-the-engine-and-each-answer-marks-its-turn.md)),
  and a turn takes the listed tools of its agent from the settings in force as it starts.
- **Reads only.** Each listed tool reaches the model as a `read` that may run beside other reads,
  named and pinned as decision 0429 says, its description led by "From the listed MCP server
  <title>:". No listed tool proposes, controls or runs a command: the tool holds no connection to
  the engine, and the client advertises no capability (no sampling, no elicitation, no roots), so
  no server can ask the model or the owner anything. An answer of the `2026-07-28` revision that
  asks for input is a `bad_answer`.
- **Every answer is outside content.** Each result of a listed tool, an error included, is stored
  with `outside` set and marks the turn.
- **The tool list marks the turn.** As decision 0350 does for plugins: while an agent has a listed
  server on, every turn of that agent starts marked. The runtime starts it with `outsideContent`
  set, and the engine sets the mark at `turn/start` whatever the runtime says, through
  `listedMcpOn(agent)`, a switch the composition root hands the engine. The switch turns on for an
  agent before the runtime is handed settings with a listing for it, and off only once the runtime
  took settings with none, as it says by answering each settings line it applied. The auto test names `listedMcp` after `plugin` and before `outside`, so
  every proposal of such an agent gets a card, whose auto mode line says "a listed MCP server is
  on, and its words reach every turn", in English and Chinese. `approval/get`, `approval/set` and
  `engine/status` keep `autoAsks` as it is, `plugin` or absent, and gain an optional
  `listedMcpOn: true` beside it for an agent in auto mode with a listed server on. A client that
  reads `autoAsks` by its one value keeps working, and drops the field it does not know.
- **Helpers** ([decision 0403](0403-the-agent-hands-bounded-work-to-helpers.md)) get their agent's
  listed tools, as reads. A helper proposes nothing, its runs start marked while they offer the
  tools, and its report reaches the agent as outside content.
- **A down or misbehaving server fails soft.** A listed tool that gets no good answer answers the
  reason as its error result, and the turn goes on: `unreachable`, `timed_out`, `too_large`,
  `bad_answer`, `refused` (an address, a redirect or arguments binference does not send),
  `rate_limited`, `busy`, `resting`, `revoked`, `listing_changed` or `tool_off`. After 3 failures
  in a row that the server caused, one for each try at a connection however many calls shared it
  and one for each request it failed, the agent's listing rests: its tools answer `resting` at
  once, with no request, for 30 seconds, the wait doubling at each failure that follows, up to 10
  minutes. A call the turn's own stop ended counts nothing, and a failed call lets its connection
  go without ending the calls in flight on it. A good answer ends the rest, one that lands during
  it too. A `429` rests it for its `Retry-After`, 1 to 600 seconds, 30 when it gives none.
  At most 4 calls of one agent to one listing run at once; a fifth answers `busy`.
- **Revocation.** A listing the settings in force no longer name answers `revoked` from its next
  call, in a running turn too, and its connection closes; the next turn does not offer it. A call
  from a turn that started on another version of its listing answers `listing_changed`, unsent,
  since the arguments passed that version's schema.
- **What is logged.** Ids, states and reasons, never an argument, an answer, a URL, a header or a
  word a server wrote. The runtime's `health` line gains `listedMcp`: each agent's listing that
  rests or has a tool off, with the reason. The engine logs `runtime.listed_mcp` with `agentId`,
  `listing`, `state` and `reason` each time one changes, which the Cloud's alarms read.
- **What the owner sees.** A progress line for each call, `turn.tool.listedMcp`, "Asking the MCP
  server {server}…", and auto mode's status lines, in English and Chinese.
- **Names.** Every name this decision adds passed the style guard's reserved-name check. The
  glossary adds "MCP listing" and "listed MCP server", in English and Chinese.

## Consequences

- A Cloud agent reads reviewed outside servers, and nothing they send can open a card that auto
  mode fills: every turn of an agent with a listed server on starts marked.
- An owner who wants auto mode turns the agent's listed servers off.
- Self-hosted agents get no listed tools in v1; offering them later needs its own decision.
- The MCP client and its dependencies join the runtime's one bundle, `runtime-process.mjs`, and the
  package graph lets `@binference/runtime` import the client package in `src/listed-mcp/` only.
- Spec 1 (`listedMcpOn`), spec 4 (the new words) and spec 6, section 5 (the auto test's order)
  change with the build.

## Alternatives

- **The engine makes the calls, as `plugin/call` does.** The engine would parse a third party's
  streams in the process that holds the money path. The runtime already reaches the network and
  holds no key, and the engine's own mark at `turn/start` keeps the engine the trust boundary.
- **Mark only at a call.** Decision 0350's reason holds: a listed tool's words are in every turn's
  context, called or not.
- **Self-hosted agents too in v1.** The owner chose Cloud only.
- **No listed tools for helpers.** Research beside the owner's chat is what helpers are for, and a
  helper can propose nothing.
- **Leave a failing server's tools out of the turn.** The tool list would change between turns as
  servers fail and recover; an answer at once costs one call and keeps the list stable.
