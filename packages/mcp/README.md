# @binference/mcp

## Purpose

The MCP server behind `binference mcp`: the engine's read and propose tools for any MCP client, such
as Claude Code or Codex. The spec is section 11 of
[docs/specs/protocol.md](../../docs/specs/protocol.md).

- **Tools.** One tool per row of the protocol's `mcpTools`, prefixed `binference_`, each calling
  one operation. Each tool's input schema is its operation's args schema from `engine/describe`.
  MCP and the model APIs behind its clients need an object at the root, so an args schema whose
  root is a union of requests, such as `intent/propose`, is listed as one object with every kind's
  fields, and the tool's description says which fields each kind takes.
- **No tool can confirm.** The tools reach `read` and `propose` operations only.
- **Texts.** Titles and descriptions are English: they reach a model, not the owner's screen.

| Tool                      | Operation       | Tool                       | Operation        |
| ------------------------- | --------------- | -------------------------- | ---------------- |
| `binference_portfolio`    | `portfolio/get` | `binference_propose`       | `intent/propose` |
| `binference_token_info`   | `asset/get`     | `binference_intent_status` | `intent/get`     |
| `binference_token_risk`   | `risk/check`    | `binference_order_create`  | `order/create`   |
| `binference_quote`        | `quote/get`     | `binference_order_cancel`  | `order/cancel`   |
| `binference_orders`       | `order/list`    | `binference_alert_create`  | `alert/create`   |
| `binference_resolve_name` | `name/resolve`  | `binference_ledger`        | `ledger/list`    |

## API

| Export                           | What it does                                                       |
| -------------------------------- | ------------------------------------------------------------------ |
| `operationTools`                 | The tools: name, operation, texts, input schema and read-only mark |
| `OperationTool`, `ToolOperation` | One tool, and the operations a tool may call                       |

## Example

```ts
import { operationTools } from "@binference/mcp";

const proposing = operationTools().filter((tool) => !tool.readOnly);
```
