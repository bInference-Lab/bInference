import { describe, expect, it } from "vitest";
import { listedToolName } from "../listed-mcp/listing.schema.js";
import { agent, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { agentTools } from "./agent-tools.js";
import { pluginToolName } from "./plugin-tools.js";

// The names of binference's own tools: lowercase words joined by underscores, never a hyphen.
const builtInName = /^[a-z][a-z0-9_]*$/;

describe("tool names", () => {
  it("keep every built-in tool's name free of a hyphen, so no listed tool's name can be one", () => {
    const built = agentTools({ agent, client: createFakeToolClient({}), turn: toolTurn });
    const names = [...Object.keys(agentToolTexts), ...built.map(({ name }) => name)];
    expect(names.filter((name) => !builtInName.test(name))).toEqual([]);
  });

  it.each(["fear-index", "a--b", "trailing-", "x-y-z"])(
    "keep the plugin %s's tool names free of a hyphen",
    (id) => {
      expect(pluginToolName(id, "tool_name")).toMatch(builtInName);
    },
  );

  it("start every listed tool's name with mcp-, which only a listed tool's name holds", () => {
    const name = listedToolName({ name: "ratesdemo" }, { as: "rate" });
    expect(name.startsWith("mcp-")).toBe(true);
    expect(name).not.toMatch(builtInName);
  });
});
