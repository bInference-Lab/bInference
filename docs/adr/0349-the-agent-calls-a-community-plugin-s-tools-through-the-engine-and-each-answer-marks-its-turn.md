# 0349. The agent calls a community plugin's tools through the engine, and each answer marks its turn

Status: Accepted

Accepted by the tech lead on 2026-11-04.

## Context

[ARCHITECTURE.md section 14](../ARCHITECTURE.md#section-14) gives a community plugin read tools
only, says each answer marks the agent's turn as outside content, and says `plugin disable` takes
the plugin's tools out of the agent's index at once.
[Decision 0300](0300-each-community-plugin-runs-in-a-process-of-its-own-that-speaks-only-to-the-plugin-host.md)
puts the plugin host in the engine, while the agent runtime is a process of its own that reaches
the engine only through the protocol ([spec 8](../specs/runtime.md)). The runtime's tools are a
fixed list today, and no operation reaches a plugin.

## Decision

- **`plugin/call`** `{ agent, plugin, tool, input }` → `{ output }`, scope `agent`, a read. The
  engine answers it only for an installed, enabled plugin it runs: `plugin.not_found` for one not
  installed, `plugin.disabled` for one off, and `plugin.call_failed` with `details.reason` (the
  host's reason, such as `timeout`, `bad_input`, `bad_output` or `not_running`) for a call with no
  answer. The host checks the input and the answer against the tool's declared schemas.
- **The mark.** When the runtime makes the call, the engine marks that agent's running turn as
  outside content before it answers, success or not, through the running turns that proposals
  read. The runtime's tool says its results are outside content too, so the transcript stores the
  mark. A proposal after a plugin's answer always gets a card.
- **The index.** The runtime's settings carry `plugins`: each enabled plugin's `plg_` id, its id
  and its tools, each with its name, description and input schema from the manifest. The engine
  sends new settings at every add, update, enable, disable, remove and turn-off, and the runtime
  builds each turn's tools from the settings in force, so a plugin turned off is gone from the next
  turn, and every call to it from then on is refused by the engine.
- **The tool.** Each tool reaches the model as a `read` that may run beside other reads, named
  `<id>__<tool>` with the id's hyphens as underscores, its description led by the words "From the
  community plugin <id>:", its input schema the manifest's, and its answer the output as JSON,
  cut at 12,000 characters as any result.

## Consequences

- A community plugin never reaches the protocol, the store or the money path: the engine calls it
  for the runtime, and only the host talks to it.
- An MCP client gets no plugin tool: `plugin/call` needs `agent`.
- A turn that calls a plugin can still propose, but never passes the auto test.

## Alternatives

- **The runtime calls the host itself.** The runtime holds no plugin process and runs as another
  process; the engine owns the host and the turn marks.
- **The runtime reads the plugin list at each turn.** One more call per turn, and a turn running
  when a plugin is turned off would keep it; the engine's refusal is what stops a call at once.
- **Mark only in the runtime.** The engine is the trust boundary; it marks the turn whatever the
  runtime does with the answer.
