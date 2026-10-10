import { describe, expect, it } from "vitest";
import { answererOf, type EngineCaller, proposerOf } from "./engine-call.js";
import { testCallers } from "./test-engine.js";

const telegram: EngineCaller = {
  credential: "tg:7012345678",
  client: { kind: "telegram" },
  scopes: ["read", "confirm"],
};

describe("who calls the engine", () => {
  it("proposes as the owner from the owner's Telegram chat, and answers there", () => {
    expect(proposerOf(telegram)).toStrictEqual({ role: "owner", ref: "telegram" });
    expect(answererOf(telegram)).toStrictEqual({ surface: "telegram", by: "tg:7012345678" });
  });

  it("proposes nothing from a Telegram caller that may only read", () => {
    expect(proposerOf({ ...telegram, scopes: ["read"] })).toBeUndefined();
  });

  it("tells the owner's CLI, an MCP client and the agent runtime apart", () => {
    expect([
      proposerOf(testCallers.cli)?.role,
      proposerOf(testCallers.mcp)?.role,
      proposerOf(testCallers.runtime)?.role,
      answererOf(testCallers.cli).surface,
    ]).toStrictEqual(["owner", "mcp_client", "agent_runtime", "cli"]);
  });
});
