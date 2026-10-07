import type { OperationName } from "../operations/operations.js";

/**
 * One tool of `binference mcp` and the operation it calls. Its input schema is the operation's
 * args schema from `engine/describe`, with an optional `requestId` for a tool that takes one.
 */
export interface McpTool {
  readonly name: `binference_${string}`;
  readonly operation: OperationName;
  /**
   * The tool takes an optional `requestId`, which the MCP server sends as the call's idempotency
   * key: a retry with the same id returns the first intent and its card instead of a new one.
   */
  readonly takesRequestId?: true;
}

/**
 * The tools of `binference mcp`, one to one onto operations (protocol spec section 11). The MCP
 * server holds only the `read` and `propose` scopes, so no tool can confirm. The propose tools,
 * which open a card, take a request id.
 */
export const mcpTools: readonly McpTool[] = [
  { name: "binference_portfolio", operation: "portfolio/get" },
  { name: "binference_token_info", operation: "asset/get" },
  { name: "binference_token_risk", operation: "risk/check" },
  { name: "binference_quote", operation: "quote/get" },
  { name: "binference_orders", operation: "order/list" },
  { name: "binference_resolve_name", operation: "name/resolve" },
  { name: "binference_propose", operation: "intent/propose", takesRequestId: true },
  { name: "binference_intent_status", operation: "intent/get" },
  { name: "binference_order_create", operation: "order/create", takesRequestId: true },
  { name: "binference_order_cancel", operation: "order/cancel" },
  { name: "binference_alert_create", operation: "alert/create" },
  { name: "binference_ledger", operation: "ledger/list" },
];
