import { mcpTools, operations } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { operationTools } from "./operation-tools.js";
import { toolTexts } from "./tool-texts.js";

const tools = operationTools();

describe("operationTools", () => {
  it("builds one tool per row of the protocol's table, in its order", () => {
    expect(tools.map((tool) => [tool.name, tool.operation])).toStrictEqual(
      mcpTools.map((tool) => [tool.name, tool.operation]),
    );
  });

  it("gives every tool its own title and description, and no text to a tool outside the table", () => {
    expect(Object.keys(toolTexts)).toStrictEqual(mcpTools.map((tool) => tool.name));
    expect(tools.map((tool) => tool.title)).toStrictEqual(
      mcpTools.map((tool) => toolTexts[tool.name]?.title),
    );
  });

  it("reaches only read and propose operations, so no tool can confirm", () => {
    const scopes = new Set(tools.map((tool) => operations[tool.operation].scope));
    expect(scopes).toStrictEqual(new Set(["read", "propose"]));
    expect(tools.filter((tool) => operations[tool.operation].scopeCase !== undefined)).toEqual([]);
  });

  it("marks the tools of read operations read-only", () => {
    expect(tools.filter((tool) => !tool.readOnly).map((tool) => tool.name)).toStrictEqual([
      "binference_propose",
      "binference_order_create",
      "binference_order_cancel",
      "binference_alert_create",
    ]);
  });

  it("tells the model the fields of each kind for a request that is a union", () => {
    const described = tools.filter((tool) => tool.description.includes("Each kind adds:"));
    expect(described.map((tool) => tool.name)).toStrictEqual([
      "binference_propose",
      "binference_order_create",
    ]);
  });
});
