# @binference/mcp

## Purpose

The MCP server behind `binference mcp`. It gives any MCP client, such as Claude Code or Codex, the
engine's read and propose tools over stdio. The spec is section 11 of
[docs/specs/protocol.md](../../docs/specs/protocol.md).

- **Tools.** One tool per row of the protocol's `mcpTools`, prefixed `binference_`, each calling
  one operation through `@binference/client`. Each tool's input schema is its operation's args
  schema from `engine/describe`. MCP and the model APIs behind its clients need an object at the
  root, so an args schema whose root is a union of requests, such as `intent/propose`, is listed as
  one object with every kind's fields, and the tool's description says which fields each kind
  takes. The operation's own schema still checks every call before it reaches the engine.
- **No tool can confirm.** The tools reach `read` and `propose` operations only, and the server
  signs in with a token that holds those two scopes, so the engine refuses anything else.
- **Proposals wait.** `binference_propose` answers with the intent's id and says it is waiting for
  the owner's confirmation in Telegram or the console. An intent the engine refused names its
  state and reason instead.
- **Retries make no second card.** `binference_propose` and `binference_order_create` take an
  optional `requestId` of 1 to 64 characters, sent as the call's idempotency key. A retry with the
  same id and the same args returns the first intent and its card; other args with that id fail
  with `protocol.key_reused`. The engine keeps a key for 24 hours.
- **Failures.** A refused or failed call answers as a tool error with the code, the engine's
  message and, for a failure a person can fix, the next step. Tool texts are English.
- **Without the engine.** Tools list while the engine is down; a call waits for the connection
  until the protocol client's call timeout.

| Tool                      | Operation       | Tool                       | Operation        |
| ------------------------- | --------------- | -------------------------- | ---------------- |
| `binference_agents`       | `agent/list`    | `binference_propose`       | `intent/propose` |
| `binference_token_search` | `asset/search`  | `binference_intent_status` | `intent/get`     |
| `binference_portfolio`    | `portfolio/get` | `binference_order_create`  | `order/create`   |
| `binference_token_info`   | `asset/get`     | `binference_order_cancel`  | `order/cancel`   |
| `binference_token_risk`   | `risk/check`    | `binference_alert_create`  | `alert/create`   |
| `binference_quote`        | `quote/get`     | `binference_ledger`        | `ledger/list`    |
| `binference_orders`       | `order/list`    | `binference_resolve_name`  | `name/resolve`   |

## Set up an MCP client

`binference mcp` reads `~/.binference/auth/mcp.token`, which holds only the `read` and `propose`
scopes. Create it once:

```sh
binference token create --for mcp
```

**Claude Code.** Add the server for every project of your user:

```sh
claude mcp add --scope user binference -- binference mcp
```

Or share it with everyone who works in a project:

```sh
claude mcp add --scope project binference -- binference mcp
```

That command writes the server to the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "binference": { "type": "stdio", "command": "binference", "args": ["mcp"], "env": {} }
  }
}
```

**Codex.** Add the server:

```sh
codex mcp add binference -- binference mcp
```

That command writes this table to `~/.codex/config.toml`, which you can also write by hand:

```toml
[mcp_servers.binference]
command = "binference"
args = ["mcp"]
```

Check it with `claude mcp list` or `codex mcp list`. Each proposal waits for your tap in
binference's Telegram bot or the console.

## Teach the client the tools

The `binference-tools` skill tells the client's model how to use these tools: the ids and amounts
a proposal takes, that every proposal waits for your tap, how to read the answer and its states,
and what only you can do (limits, paper or live, freeze and rescue). It never asks for a key or a
seed phrase. Copy the repo's [`skills/binference-tools`](../../skills/binference-tools/SKILL.md)
folder into the client's skills folder:

| Client      | Folder                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| Claude Code | `~/.claude/skills/binference-tools/`, or a project's `.claude/skills/` |
| Codex       | `~/.agents/skills/binference-tools/`, or a repo's `.agents/skills/`    |

The client finds your agent with `binference_agents` and each token's id with
`binference_token_search`, so it needs no id from you. The token search reads only binference's
token list and what your wallets hold, and asks you when a symbol matches several tokens.

`pnpm skill:run` checks the skill with Claude Code. It runs `claude -p "swap 0.01 BNB to USDT"`
headless, in a home and config folder of its own with the skill installed there, against an engine
on paper with the fake chain and venue under BNB Smart Chain's names
(`packages/cli/src/skill-run/`). It records each tool call the MCP server gets, checks that the
one proposal is that swap with the right ids and base units, and prints the verdict. It needs
`claude` on the PATH and `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`)
in the environment, makes model calls, and leaves every file of the run in its output folder
(`--out <folder>`; `--model <model>` picks the model).

## API

| Export                          | What it does                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `serveMcpOverStdio`             | Serves the tools over stdio until the MCP client closes stdin or a signal aborts |
| `createMcpServer`               | The MCP server with its tools, for any MCP transport                             |
| `McpServerOptions`, `McpLogger` | The protocol client, the release and the logger the server is built from         |
| `McpStdioOptions`, `McpStreams` | Those options, and the streams for tests                                         |

## Example

The composition root signs in with the MCP token over the engine's IPC socket and serves:

```ts
import { createProtocolClient } from "@binference/client";
import { serveMcpOverStdio } from "@binference/mcp";
import { operations } from "@binference/protocol";

const client = createProtocolClient({
  operations,
  openSocket: () => ipcSocket(paths.engineSocket),
  client: { kind: "mcp", version },
  credential: { token: mcpToken },
  clock,
  random,
  logger: logger.child("mcp"),
});
await serveMcpOverStdio({ client, version, logger: logger.child("mcp") }, shutdown.signal);
```
