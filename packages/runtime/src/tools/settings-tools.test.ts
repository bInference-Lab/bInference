import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, intentWire, outcomeOf } from "../testing/agent-tool-fixtures.js";

const refusal = (code: `${string}.${string}`) =>
  new BinferenceError({ code, message: `The engine said ${code}.` });

const hash = "a".repeat(64);
const proposedWire = {
  ...intentWire("awaiting_confirmation"),
  kind: "configChange",
  request: { kind: "configChange", patch: { logging: { level: "debug" } } },
};

describe("settings_read", () => {
  it("reads one key with the rules under it, as the engine answers it", async () => {
    const view = {
      value: "info",
      rules: [{ path: "logging.level", description: "", takes: "a level" }],
      hash,
    };
    const run = callTool(
      { "config/view": view },
      { name: "settings_read", args: { key: "logging.level" } },
    );
    const outcome = await outcomeOf(run);
    expect(JSON.parse(outcome.text)).toStrictEqual(view);
    expect(run.client.calls().map(({ op, args }) => [op, args])).toStrictEqual([
      ["config/view", { path: "logging.level" }],
    ]);
  });

  it("reads a key the config has not as nothing read and where to look", async () => {
    const run = callTool(
      { "config/view": refusal("protocol.bad_args") },
      { name: "settings_read", args: { key: "nowhere" } },
    );
    await expect(outcomeOf(run)).resolves.toMatchObject({ isError: true });
  });
});

describe("settings_change", () => {
  it("proposes every key in one merge patch, with the reason, for its agent", async () => {
    const changes = [
      { key: "logging.level", value: "debug" },
      { key: "logging.file", value: null },
      { key: "engine.port", value: 7460 },
    ];
    const run = callTool(
      { "config/propose": proposedWire },
      {
        name: "settings_change",
        args: {
          changes,
          reason: "The owner asked for more detail.",
          baseHash: hash,
          replace: ["models.imageInput"],
        },
      },
    );
    const outcome = await outcomeOf(run);
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain("nothing changes until they tap Confirm");
    expect(run.client.calls()[0]?.args).toStrictEqual({
      patch: { logging: { level: "debug", file: null }, engine: { port: 7460 } },
      reason: "The owner asked for more detail.",
      agent,
      baseHash: hash,
      replacePaths: ["models.imageInput"],
    });
  });

  it.each([
    ["config.invalid", "fail its checks"],
    ["config.secret_inline", "never goes in the config"],
    ["protocol.bad_args", "sets nothing new"],
    ["config.changed", "changed since you read them"],
    ["config.list_shrinks", "drops entries from a list"],
    ["config.secret_unreadable", "not there to read"],
  ] as const)("reads %s as nothing proposed and what to do next", async (code, words) => {
    const args = {
      changes: [{ key: "logging.level", value: "loud" }],
      reason: "A test.",
      baseHash: hash,
    };
    const outcome = await outcomeOf(
      callTool({ "config/propose": refusal(code) }, { name: "settings_change", args }),
    );
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.text).toContain(words);
  });
});
