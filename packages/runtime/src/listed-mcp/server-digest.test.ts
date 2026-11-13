import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixtureServerTool } from "../testing/listing-fixture.js";
import { serverDigestOf } from "./server-digest.js";

describe("serverDigestOf", () => {
  it("hashes the name and both schemas as canonical JSON", () => {
    const canonical =
      '{"inputSchema":{"properties":{"symbol":{"type":"string"}},"required":["symbol"],"type":"object"},' +
      '"name":"get_rate",' +
      '"outputSchema":{"properties":{"rate":{"type":"number"}},"required":["rate"],"type":"object"}}';
    const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
    expect(serverDigestOf(fixtureServerTool)).toBe(expected);
  });

  it("gives one digest whatever order the server wrote the keys in", () => {
    const reordered = {
      outputSchema: {
        required: ["rate"],
        properties: { rate: { type: "number" } },
        type: "object",
      },
      name: "get_rate",
      inputSchema: {
        required: ["symbol"],
        type: "object",
        properties: { symbol: { type: "string" } },
      },
    };
    expect(serverDigestOf(reordered)).toBe(serverDigestOf(fixtureServerTool));
  });

  it("changes with the output schema, and without one", () => {
    const { outputSchema: _output, ...withoutOutput } = fixtureServerTool;
    expect(serverDigestOf(withoutOutput)).not.toBe(serverDigestOf(fixtureServerTool));
    const widened = { ...fixtureServerTool, outputSchema: { type: "object" } };
    expect(serverDigestOf(widened)).not.toBe(serverDigestOf(fixtureServerTool));
  });
});
