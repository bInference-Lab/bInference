# @binference/mcp

The MCP server: the engine's read and propose tools for any MCP client, over stdio. The spec is
section 11 of [docs/specs/protocol.md](../../docs/specs/protocol.md).

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It talks to the engine only through a `ProtocolClient` from `@binference/client`, signed in with
  a token that holds `read` and `propose`. It never opens a socket, reads a token file or reads
  `process.env`: the composition root builds the client and passes it in.
- Tools come from the protocol's `mcpTools`, one per row, and each tool's input schema from
  `describeOperations`, with an optional `requestId` for a row marked `takesRequestId`. Never write
  a tool, its operation or its schema by hand; a new tool is a row in the protocol's table. Only
  titles and descriptions live here, in `tool-texts.ts`.
- A `requestId` is the protocol call's idempotency key and never reaches the operation's args.
- Every tool reads or proposes. A tool never reaches an operation of another scope, so no tool can
  confirm, deny, loosen or change settings.
- Stdout carries MCP messages only: nothing else writes to it. Logs go through the logger, with
  ids and error codes, never args or results.
- Tool texts and tool errors are English: they reach a model, not the owner's screen.
- Tests drive the server through the MCP SDK's own client. Only `src/e2e/` may import
  `@modelcontextprotocol/client`; the stdio tests start `src/e2e/stdio-server.entry.ts` as its own
  process with a 60-second timeout and close every client.
