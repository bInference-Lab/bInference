import { describe, expect, it } from "vitest";
import { operations } from "../operations/operations.js";
import { mcpTools } from "./mcp-tools.js";

describe("mcpTools", () => {
  it("maps each tool of the spec one to one onto its operation", () => {
    expect(mcpTools.map((tool) => [tool.name, tool.operation])).toStrictEqual([
      ["binference_portfolio", "portfolio/get"],
      ["binference_token_info", "asset/get"],
      ["binference_token_risk", "risk/check"],
      ["binference_quote", "quote/get"],
      ["binference_orders", "order/list"],
      ["binference_resolve_name", "name/resolve"],
      ["binference_propose", "intent/propose"],
      ["binference_intent_status", "intent/get"],
      ["binference_order_create", "order/create"],
      ["binference_order_cancel", "order/cancel"],
      ["binference_alert_create", "alert/create"],
      ["binference_ledger", "ledger/list"],
    ]);
    expect(new Set(mcpTools.map((tool) => tool.operation)).size).toBe(mcpTools.length);
  });

  it("reaches only operations the read and propose scopes allow, so no tool can confirm", () => {
    const reached = mcpTools.map((tool) => tool.operation);
    expect(new Set(reached.map((name) => operations[name].scope))).toStrictEqual(
      new Set(["read", "propose"]),
    );
    expect(reached.filter((name) => operations[name].scopeCase !== undefined)).toStrictEqual([]);
  });

  it("serves both transports, since the MCP server reaches the engine over IPC", () => {
    expect(mcpTools.filter((tool) => operations[tool.operation].transport !== "any")).toStrictEqual(
      [],
    );
  });
});
