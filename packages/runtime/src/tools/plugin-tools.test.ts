import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { RuntimePlugin } from "../control/runtime-settings.schema.js";
import type { ToolBox } from "../loop/ports.js";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agent, context, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { agentToolBox } from "./agent-tools.js";

const plugin = "plg_0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b";
const fearIndex: RuntimePlugin = {
  plugin,
  id: "fear-index",
  tools: [
    {
      name: "index",
      description: "Reads the fear and greed index for a number of days.",
      input: {
        type: "object",
        properties: { days: { type: "integer", minimum: 1, maximum: 30 } },
        required: ["days"],
        additionalProperties: false,
      },
    },
    {
      name: "loose",
      description: "Takes any fields.",
      input: { type: "object", properties: { a: { type: "string" } } },
    },
  ],
};

function boxWith(
  answers: Readonly<Record<string, FakeAnswer>>,
  plugins: readonly RuntimePlugin[] = [fearIndex],
) {
  const client = createFakeToolClient(answers);
  return { client, box: agentToolBox({ agent, client, turn: toolTurn, plugins }) };
}

// Runs one call the box took; a call it refused fails the test.
async function runCall(box: ToolBox, argumentsText: string): Promise<ToolOutcome> {
  const prepared = box.prepare({ id: "c1", name: "fear_index__index", argumentsText });
  if (!prepared.ready) {
    throw new Error(`The call was refused: ${prepared.text}`);
  }
  return prepared.run(context);
}

const toolNames = (plugins: readonly RuntimePlugin[]): readonly string[] =>
  boxWith({}, plugins).box.declarations.map(({ name }) => name);

describe("the tools of community plugins", () => {
  it("offer each tool as <id>__<tool>, led by the plugin's id, with the manifest's input", () => {
    const declaration = boxWith({}).box.declarations.find(
      ({ name }) => name === "fear_index__index",
    );

    expect(declaration).toMatchObject({
      description:
        "From the community plugin fear-index: Reads the fear and greed index for a number of days.",
      parameters: { type: "object", required: ["days"], additionalProperties: false },
    });
  });

  it("leave out a tool whose input lets an object take fields it does not name", () => {
    expect(toolNames([fearIndex])).not.toContain("fear_index__loose");
  });

  it("are gone from a turn whose settings name no plugin", () => {
    expect(toolNames([]).filter((name) => name.includes("__"))).toStrictEqual([]);
  });

  it("call plugin/call for the turn's agent and answer the output as outside content", async () => {
    const { client, box } = boxWith({ "plugin/call": { output: { value: 40 } } });
    const prepared = box.prepare({
      id: "c1",
      name: "fear_index__index",
      argumentsText: '{"days":7}',
    });

    expect(prepared).toMatchObject({ ready: true, kind: "read", outside: true, parallel: true });
    expect(await runCall(box, '{"days":7}')).toStrictEqual({
      text: '{"value":40}',
      isError: false,
    });
    expect(client.calls()).toStrictEqual([
      {
        op: "plugin/call",
        args: { agent, plugin, tool: "index", input: { days: 7 } },
      },
    ]);
  });

  it("refuse input the manifest's schema refuses, before the engine hears of it", () => {
    const { client, box } = boxWith({});
    const prepared = box.prepare({
      id: "c1",
      name: "fear_index__index",
      argumentsText: '{"days":99}',
    });

    expect(prepared.ready).toBe(false);
    expect(client.calls()).toStrictEqual([]);
  });

  it("refuse a field the manifest's schema does not name, never strip it", () => {
    const { client, box } = boxWith({});
    const prepared = box.prepare({
      id: "c1",
      name: "fear_index__index",
      argumentsText: '{"days":7,"note":"x"}',
    });

    expect(prepared.ready).toBe(false);
    expect(client.calls()).toStrictEqual([]);
  });

  it("answer the engine's refusal of a plugin turned off as the tool's failure", async () => {
    const off = new BinferenceError({ code: "plugin.disabled", message: "The plugin is off." });
    const { box } = boxWith({ "plugin/call": off });

    expect(await runCall(box, '{"days":7}')).toStrictEqual({
      text: "fear_index__index failed with plugin.disabled: The plugin is off.",
      isError: true,
    });
  });
});
