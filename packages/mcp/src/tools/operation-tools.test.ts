import { mcpTools, operations } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type OperationTool, operationTools } from "./operation-tools.js";
import { requestIdText, toolTexts } from "./tool-texts.js";

const tools = operationTools();
const propertiesSchema = z.record(z.string(), z.unknown()).catch({});

// The properties a tool's input schema lists, or none.
function propertiesOf(tool: OperationTool): Readonly<Record<string, unknown>> {
  return propertiesSchema.parse(tool.inputSchema["properties"]);
}

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

  it("lists an optional request id on the propose tools only, with what the model reads", () => {
    const taking = tools.filter((tool) => "requestId" in propertiesOf(tool));
    expect(taking.map((tool) => [tool.name, tool.takesRequestId])).toStrictEqual([
      ["binference_propose", true],
      ["binference_order_create", true],
    ]);
    for (const tool of taking) {
      expect(tool.inputSchema["properties"]).toMatchObject({
        requestId: { type: "string", minLength: 1, maxLength: 64, description: requestIdText },
      });
      expect(tool.inputSchema["required"]).not.toContain("requestId");
    }
  });

  it("tells the model the fields of each kind for a request that is a union", () => {
    const described = tools.filter((tool) => tool.description.includes("Each kind adds:"));
    expect(described.map((tool) => tool.name)).toStrictEqual([
      "binference_propose",
      "binference_order_create",
    ]);
  });
});
