import { describe, expect, it } from "vitest";
import { agentToolTexts } from "./agent-tool-texts.js";
import { describeAgentTools } from "./tool-reference.js";

describe("describeAgentTools", () => {
  const tools = describeAgentTools();

  it("lists every tool the agent may call, the web tools with the X search too", () => {
    expect(tools.map((tool) => tool.name).toSorted()).toStrictEqual(
      Object.keys(agentToolTexts).toSorted(),
    );
  });

  it("gives each tool the kind it runs as and the text its model reads", () => {
    expect(tools.find((tool) => tool.name === "portfolio")).toStrictEqual({
      name: "portfolio",
      kind: "read",
      description: agentToolTexts.portfolio,
    });
    expect(tools.find((tool) => tool.name === "swap")?.kind).toBe("propose");
    expect(tools.find((tool) => tool.name === "ask_owner")?.kind).toBe("control");
  });
});
