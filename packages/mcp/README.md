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

One command sets a client up with the engine running: a client token of its own, its MCP server
entry and the `binference-tools` skill.

```sh
binference mcp setup --client claude-code
binference mcp setup --client codex
```

Run it again after an update: it changes only what differs. `--dry-run` shows the changes and makes
none; `--remove` undoes the setup and revokes the client's token. `--ttl <duration>` (`30m`, `12h`,
`7d`, at most `90d`) gives the client a new token that expires after that long; without it the token
works until it is revoked. Once it expires, the tools fail with `auth.expired` until you run the
setup again. The entry runs
`binference mcp --client <client>`, which signs in with `auth/mcp-<client>.token` in the state
folder, so the client's config holds no secret.

| Client      | MCP server entry                                            | Skill                                |
| ----------- | ----------------------------------------------------------- | ------------------------------------ |
| Claude Code | User scope, through `claude mcp add-json` or `.claude.json` | `~/.claude/skills/binference-tools/` |
| Codex       | `[mcp_servers.binference]` in `~/.codex/config.toml`        | `~/.agents/skills/binference-tools/` |

## Use the tools for one session

`binference mcp session` starts a client with the tools for this session alone, with a client token
of its own that expires after 1 hour (`--ttl 30m` to `--ttl 24h`) and is revoked when the client
exits. The arguments after `--` go to the client.

```sh
binference mcp session --client claude-code
binference mcp session --client codex --ttl 4h -- --model gpt-5
```

The token reaches the client in its environment as `BINFERENCE_MCP_TOKEN`, never in its arguments
or a file. Claude Code starts with `--strict-mcp-config` and a config file that lists only
binference's server, written owner-only in the state folder and removed at the end. Codex starts
with `-c` overrides of its `binference` server and keeps its other servers. `--print-config` prints
the config and the token for a client you start yourself; that token works until it expires. The
skill comes from `binference mcp setup` or a copy by hand.

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` move Claude Code's and Codex's folders as they do for the
clients. Check the result with `claude mcp list` or `codex mcp list`. Each proposal waits for your
tap in binference's Telegram bot or the console.

## Teach the client the tools

The `binference-tools` skill tells the client's model how to use these tools: the ids and amounts
a proposal takes, that every proposal waits for your tap, how to read the answer and its states,
and what only you can do (limits, paper or live, freeze and rescue). It never asks for a key or a
seed phrase. `binference mcp setup` installs it; to add it by hand, copy the repo's
[`skills/binference-tools`](../../skills/binference-tools/SKILL.md) folder into the client's skills
folder:

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
