import { BinferenceError } from "@binference/core";
import { defineTools } from "@binference/plugin-sdk/community";
import { describe, expect, it } from "vitest";
import { servePlugin } from "./serve-plugin.js";

const start = {
  kind: "start",
  entry: "/plugins/fear/index.mjs",
  dataFolder: "/plugins/fear-data",
  config: { level: 2 },
  hosts: [],
};
const call = (id: string, tool: string, input: object = {}) => ({
  kind: "call",
  id,
  tool,
  input,
  timeoutMs: 5_000,
});

const tools = defineTools({
  echo: async (input, context) => ({ input, config: context.config }),
  coded: async () => {
    throw new BinferenceError({ code: "feed.down", message: "The feed is down." });
  },
  thrown: async () => {
    throw new Error("Not a coded error");
  },
  shapeless: async () => (() => 1) as never,
  fetching: async (_input, context) => {
    const answer = await context.fetch({ url: "https://api.example.com/x" });
    return { status: answer.status };
  },
  refused_fetch: async (_input, context) => {
    await context.fetch({ url: "https://other.example.net/" });
    return null;
  },
});

// Lets the calls still running finish: each awaits a few promises at most.
async function settle(turns: number): Promise<void> {
  if (turns > 0) {
    await Promise.resolve();
    await settle(turns - 1);
  }
}

// Feeds the plugin's side the host's messages and answers what it wrote, each parsed.
async function served(messages: readonly object[], loaded: string[] = []) {
  const written: object[] = [];
  const lines = messages.map((message) => `${JSON.stringify(message)}\n`);
  async function* input(): AsyncGenerator<Uint8Array> {
    for (const line of lines) {
      yield Buffer.from(line);
    }
  }
  await servePlugin({
    input: input(),
    write: (line) => written.push(JSON.parse(line) as object),
    load: async (entry) => {
      loaded.push(entry);
      return tools;
    },
  });
  await settle(20);
  return written;
}

describe("servePlugin", () => {
  it("loads the entry at start, answers ready, and runs each call with the config", async () => {
    const loaded: string[] = [];
    const written = await served([start, call("c1", "echo", { a: 1 })], loaded);

    expect(loaded).toStrictEqual(["/plugins/fear/index.mjs"]);
    expect(written).toStrictEqual([
      {
        kind: "ready",
        tools: ["echo", "coded", "thrown", "shapeless", "fetching", "refused_fetch"],
      },
      { kind: "result", id: "c1", output: { input: { a: 1 }, config: { level: 2 } } },
    ]);
  });

  it("answers failed with a coded error's own code, else the plugin's, and for an answer not JSON", async () => {
    const written = await served([
      start,
      call("c1", "coded"),
      call("c2", "thrown"),
      call("c3", "shapeless"),
      call("c4", "missing"),
    ]);

    expect(written.slice(1)).toStrictEqual([
      { kind: "failed", id: "c1", code: "feed.down" },
      { kind: "failed", id: "c2", code: "plugin.tool_failed" },
      { kind: "failed", id: "c3", code: "plugin.bad_output" },
      { kind: "failed", id: "c4", code: "plugin.unknown_tool" },
    ]);
  });

  it("asks the host to fetch and hands the tool its answer or its refusal", async () => {
    const written = await served([
      start,
      call("c1", "fetching"),
      { kind: "fetched", id: "f1", status: 200, headers: {}, body: "{}" },
      call("c2", "refused_fetch"),
      { kind: "fetchRefused", id: "f2", refused: "host_refused" },
    ]);

    expect(written.slice(1)).toStrictEqual([
      {
        kind: "fetch",
        id: "f1",
        request: { url: "https://api.example.com/x", method: "GET", headers: {} },
      },
      { kind: "result", id: "c1", output: { status: 200 } },
      {
        kind: "fetch",
        id: "f2",
        request: { url: "https://other.example.net/", method: "GET", headers: {} },
      },
      { kind: "failed", id: "c2", code: "plugin.host_refused" },
    ]);
  });

  it("stops at a first message that is not start, or a second start", async () => {
    await expect(served([call("c1", "echo")])).rejects.toMatchObject({
      code: "plugin.channel_order",
    });
    await expect(served([start, start])).rejects.toMatchObject({ code: "plugin.channel_order" });
  });
});
