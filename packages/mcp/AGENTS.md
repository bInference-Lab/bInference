# @binference/mcp

The MCP server: the engine's read and propose tools for any MCP client, over stdio. The spec is
section 11 of [docs/specs/protocol.md](../../docs/specs/protocol.md).

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- Tools come from the protocol's `mcpTools`, one per row, and each tool's input schema from
  `describeOperations`. Never write a tool, its operation or its schema by hand; a new tool is a
  row in the protocol's table. Only titles and descriptions live here, in `tool-texts.ts`.
- Every tool reads or proposes. A tool never reaches an operation of another scope, so no tool can
  confirm, deny, loosen or change settings.
- Tool texts are English: they reach a model, not the owner's screen.
