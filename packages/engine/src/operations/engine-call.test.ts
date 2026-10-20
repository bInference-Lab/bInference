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
    expect(proposerOf(telegram)).toStrictEqual({
      role: "owner",
      ref: "telegram",
      hasOutsideContent: false,
    });
    expect(answererOf(telegram)).toStrictEqual({ surface: "telegram", by: "tg:7012345678" });
  });

  it("proposes as the owner on Telegram from the Mini App, and answers there", () => {
    const mini: EngineCaller = {
      credential: "tg:7012345678",
      client: { kind: "mini", version: "console" },
      scopes: ["read", "chat", "confirm", "loosen"],
      transport: "ws",
    };
    expect(proposerOf(mini)).toStrictEqual({
      role: "owner",
      ref: "telegram",
      hasOutsideContent: false,
    });
    expect(answererOf(mini)).toStrictEqual({ surface: "mini", by: "tg:7012345678" });
  });

  it("proposes nothing from a credential that only looks like a Telegram id", () => {
    const caller: EngineCaller = {
      credential: "tg:owner",
      client: { kind: "mini", version: "console" },
      scopes: ["read", "confirm"],
    };
    expect(proposerOf(caller)).toBeUndefined();
  });

  it("proposes from Telegram with the mark of the turn that drafted the launch, and only then", () => {
    const marked = { ...telegram, turn: { hasOutsideContent: true } };
    const clean = { ...telegram, turn: { hasOutsideContent: false } };
    expect(
      [proposerOf(marked), proposerOf(clean)].map((proposer) => proposer?.hasOutsideContent),
    ).toStrictEqual([true, false]);
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

  it("names the surface by the credential, whatever client kind the caller says", () => {
    const device: EngineCaller = {
      credential: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001",
      client: { kind: "cli", version: "console" },
      scopes: ["read", "confirm"],
    };
    const token = { ...testCallers.cli, client: { kind: "console", version: "test" } } as const;
    const mini = { ...telegram, client: { kind: "cli", version: "test" } } as const;
    expect(
      [answererOf(device), answererOf(token), answererOf(mini)].map((a) => a.surface),
    ).toStrictEqual(["console", "cli", "mini"]);
  });

  it("marks the agent runtime's proposal as outside content unless its turn read none", () => {
    const { turn: _turn, ...signedIn } = testCallers.runtime;
    const marked = { ...signedIn, turn: { hasOutsideContent: true } };
    expect([
      proposerOf(signedIn)?.hasOutsideContent,
      proposerOf(marked)?.hasOutsideContent,
      proposerOf(testCallers.runtime)?.hasOutsideContent,
      proposerOf(testCallers.mcp)?.hasOutsideContent,
      proposerOf(testCallers.cli)?.hasOutsideContent,
    ]).toStrictEqual([true, true, false, false, false]);
  });
});
