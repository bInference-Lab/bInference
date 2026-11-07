import { describe, expect, it } from "vitest";
import type { ModelImage } from "../loop/model-message.js";
import { createTestTurn, type TestTool } from "../loop/test-turns.js";
import {
  callsReply,
  createScriptedTransport,
  createTestChain,
  type ScriptedTransport,
  textReply,
} from "../testing/scripted-transport.js";

const chart: ModelImage = { contentType: "image/png", data: "iVBORw0KGgo=" };

// A read tool that looks at the chart with the agent's question and answers what it saw.
const looker: TestTool = {
  name: "look_at_image",
  kind: "read",
  run: async (context) => {
    const seen = await context.look([chart], "Which way does it trend?");
    return seen.ok ? { text: seen.value, isError: false } : { text: seen.error, isError: true };
  },
};

function lookTurn(options: { readonly mainReads: boolean; readonly vision?: ScriptedTransport }) {
  const look = options.mainReads ? [textReply("A rising line.")] : [];
  const main = createScriptedTransport([
    callsReply([{ name: "look_at_image" }]),
    ...look,
    textReply("It trends up."),
  ]);
  const { vision } = options;
  return {
    main,
    ...createTestTurn({
      replies: [],
      tools: [looker],
      models: (clock) =>
        createTestChain(
          [
            {
              name: "test/model",
              transport: main,
              ...(options.mainReads && { readsImages: true }),
            },
          ],
          { clock },
        ),
      ...(vision !== undefined && {
        vision: (clock) =>
          createTestChain([{ name: "test/eyes", transport: vision, readsImages: true }], {
            clock,
          }),
      }),
    }),
  };
}

function toolText(transport: ScriptedTransport): unknown {
  return transport.requests.at(-1)?.messages.find((message) => message.role === "tool");
}

describe("a tool's look at an image", () => {
  it("asks the turn's own model when it takes images, the agent's question beside the image", async () => {
    const { turn, main } = lookTurn({ mainReads: true });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(main.requests[1]?.messages).toMatchObject([
      {
        role: "owner",
        text: "Describe this image. The agent wants to know: Which way does it trend?",
        images: [chart],
      },
    ]);
    expect(main.requests[1]?.tools).toStrictEqual([]);
    expect(toolText(main)).toMatchObject({ text: "A rising line." });
  });

  it("asks the vision model when the turn's model takes none", async () => {
    const vision = createScriptedTransport([textReply("A falling line.")]);
    const { turn, main, recorder } = lookTurn({ mainReads: false, vision });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(vision.requests[0]?.messages[0]).toMatchObject({ images: [chart] });
    expect(toolText(main)).toMatchObject({ text: "A falling line." });
    expect(recorder.steps.filter((step) => step.kind === "usage")).toMatchObject([
      { model: "test/model" },
      { model: "test/eyes" },
      { model: "test/model" },
    ]);
  });

  it("answers no_model when no model of the turn takes images", async () => {
    const { turn, main } = lookTurn({ mainReads: false });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(toolText(main)).toMatchObject({ text: "no_model" });
  });
});
