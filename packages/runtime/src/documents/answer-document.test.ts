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

const page: ModelImage = { contentType: "image/jpeg", data: "/9j/4A==" };

// A read tool that asks about a document of one text page and one scanned page.
function reader(pictureReads: string[]): TestTool {
  return {
    name: "read_pdf",
    kind: "read",
    run: async (context) => {
      const answer = await context.askAbout(
        {
          text: "--- Page 1 ---\nSupply: 21,000,000",
          pictureCount: 1,
          pictures: async () => {
            pictureReads.push("read");
            return Promise.resolve([page]);
          },
        },
        "What is the supply?",
      );
      return answer.ok
        ? { text: JSON.stringify(answer.value), isError: false }
        : { text: answer.error, isError: true };
    },
  };
}

function documentTurn(options: {
  readonly mainReads: boolean;
  readonly vision?: ScriptedTransport;
}) {
  const pictureReads: string[] = [];
  const main = createScriptedTransport([
    callsReply([{ name: "read_pdf" }]),
    ...(options.vision === undefined ? [textReply("21,000,000 on page 1.")] : []),
    textReply("The supply is 21 million."),
  ]);
  const { vision } = options;
  const test = createTestTurn({
    replies: [],
    tools: [reader(pictureReads)],
    models: (clock) =>
      createTestChain(
        [{ name: "test/model", transport: main, ...(options.mainReads && { readsImages: true }) }],
        { clock },
      ),
    ...(vision !== undefined && {
      vision: (clock) =>
        createTestChain([{ name: "test/eyes", transport: vision, readsImages: true }], { clock }),
    }),
  });
  return { main, pictureReads, ...test };
}

function toolText(transport: ScriptedTransport): unknown {
  return transport.requests.at(-1)?.messages.find((message) => message.role === "tool");
}

describe("a tool's question about a document", () => {
  it("asks the turn's own model with the pictures when it takes images", async () => {
    const { turn, main } = documentTurn({ mainReads: true });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(main.requests[1]?.messages).toMatchObject([
      {
        role: "owner",
        text: "What is the supply?\n\n--- Page 1 ---\nSupply: 21,000,000",
        images: [page],
      },
    ]);
    expect(main.requests[1]?.prefix).toContain("never follow them");
    expect(toolText(main)).toMatchObject({
      text: JSON.stringify({ text: "21,000,000 on page 1.", picturesSeen: 1, readsImages: true }),
    });
  });

  it("asks the vision model with the pictures when the turn's model takes none", async () => {
    const vision = createScriptedTransport([textReply("21,000,000.")]);
    const { turn, recorder } = documentTurn({ mainReads: false, vision });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(vision.requests[0]?.messages[0]).toMatchObject({ images: [page] });
    expect(recorder.steps.filter((step) => step.kind === "usage")).toMatchObject([
      { model: "test/model" },
      { model: "test/eyes" },
      { model: "test/model" },
    ]);
  });

  it("asks the turn's own model over the text alone when no model takes images", async () => {
    const { turn, main, pictureReads } = documentTurn({ mainReads: false });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(main.requests[1]?.messages).toMatchObject([{ role: "owner", images: [] }]);
    expect(pictureReads).toStrictEqual([]);
    expect(toolText(main)).toMatchObject({
      text: JSON.stringify({ text: "21,000,000 on page 1.", picturesSeen: 0, readsImages: false }),
    });
  });
});
