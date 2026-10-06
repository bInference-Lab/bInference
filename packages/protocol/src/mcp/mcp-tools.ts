import type { OperationName } from "../operations/operations.js";

/**
 * One tool of `binference mcp` and the operation it calls. Its input schema is the operation's
 * args schema from `engine/describe`.
 */
export interface McpTool {
  readonly name: `binference_${string}`;
  readonly operation: OperationName;
}

/**
 * The tools of `binference mcp`, one to one onto operations (protocol spec section 11). The MCP
 * server holds only the `read` and `propose` scopes, so no tool can confirm.
 */
export const mcpTools: readonly McpTool[] = [
  { name: "binference_portfolio", operation: "portfolio/get" },
  { name: "binference_token_info", operation: "asset/get" },
  { name: "binference_token_risk", operation: "risk/check" },
  { name: "binference_quote", operation: "quote/get" },
  { name: "binference_orders", operation: "order/list" },
  { name: "binference_resolve_name", operation: "name/resolve" },
  { name: "binference_propose", operation: "intent/propose" },
  { name: "binference_intent_status", operation: "intent/get" },
  { name: "binference_order_create", operation: "order/create" },
  { name: "binference_order_cancel", operation: "order/cancel" },
  { name: "binference_alert_create", operation: "alert/create" },
  { name: "binference_ledger", operation: "ledger/list" },
];
