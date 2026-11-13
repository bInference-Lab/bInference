import { describe, expect, it } from "vitest";
import { agentToolTexts } from "../tools/agent-tool-texts.js";
import { progressKeyOf } from "./progress-keys.js";

describe("progressKeyOf", () => {
  it("gives every agent tool a line but the question to the owner and the first chat's end", () => {
    const silent = Object.keys(agentToolTexts).filter((tool) => progressKeyOf(tool) === undefined);
    expect(silent.toSorted()).toStrictEqual(["ask_owner", "first_chat_end"]);
    expect(progressKeyOf("token_risk")).toStrictEqual({ key: "turn.tool.tokenRisk" });
  });

  it("gives every agent tool a line of its own", () => {
    const keys = Object.keys(agentToolTexts)
      .map((tool) => progressKeyOf(tool))
      .filter((line) => line !== undefined)
      .map((line) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names a plugin's tool by its plugin, and no tool that does not exist", () => {
    expect(progressKeyOf("fear_index__index")).toStrictEqual({
      key: "turn.tool.plugin",
      values: { plugin: "fear_index" },
    });
    expect(progressKeyOf("made_up")).toBeUndefined();
    expect(progressKeyOf("Bad__tool")).toBeUndefined();
  });

  it("names a listed MCP tool by its server's name in the listing", () => {
    expect(progressKeyOf("mcp-ratesdemo-rate")).toStrictEqual({
      key: "turn.tool.listedMcp",
      values: { server: "ratesdemo" },
    });
    expect(progressKeyOf("mcp-Rates-rate")).toBeUndefined();
  });
});
