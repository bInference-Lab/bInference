import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { ModelImage, OwnerMessage } from "../loop/model-message.js";
import { createTestTurn } from "../loop/test-turns.js";
import type { ImageReadRefusal, ReadImage } from "../loop/turn-records.js";
import {
  createScriptedTransport,
  createTestChain,
  type ScriptedTransport,
  textReply,
} from "../testing/scripted-transport.js";
import type { RecordedStep } from "../testing/turn-recorder.js";
import { describedImageNote } from "./image-notes.js";

const chart: ModelImage = { contentType: "image/png", data: "iVBORw0KGgo=" };
const photo: ModelImage = { contentType: "image/jpeg", data: "/9j/4AAQ" };

// The owner's message with images, as the chat queue hands it to a turn.
function withImages(text: string, images: readonly string[]): OwnerMessage {
  return { id: "msg_1", text, outside: true, images };
}

// The engine's images by name; any other is refused as gone.
function reader(reads: string[] = []): ReadImage {
  const images = new Map([
    ["tg:chart", chart],
    ["tg:photo", photo],
  ]);
  const refused = new Map<string, ImageReadRefusal>([
    ["tg:huge", "too_large"],
    ["tg:gif", "format"],
  ]);
  return async ({ image }) => {
    reads.push(image);
    const held = images.get(image);
    return Promise.resolve(held === undefined ? err(refused.get(image) ?? "unreadable") : ok(held));
  };
}

function statusOf(steps: readonly RecordedStep[]): readonly RecordedStep[] {
  return steps.filter((step) => step.kind === "status" || step.kind === "journalEnd");
}

// A turn whose main model, `test/model`, takes images or not, with or without a vision model.
function imageTurn(options: {
  readonly taken: OwnerMessage;
  readonly mainReads: boolean;
  readonly vision?: ScriptedTransport;
  readonly reads?: string[];
}) {
  const { vision } = options;
  const main = createScriptedTransport([textReply("A rising chart.")]);
  return {
    main,
    ...createTestTurn({
      replies: [],
      taken: [options.taken],
      readImage: reader(options.reads),
      models: (clock) =>
        createTestChain(
          [
            {
              name: "test/model",
              transport: main,
              ...(options.mainReads ? { readsImages: true } : {}),
            },
          ],
          { clock },
        ),
      ...(vision === undefined
        ? {}
        : {
            vision: (clock) =>
              createTestChain([{ name: "test/eyes", transport: vision, readsImages: true }], {
                clock,
              }),
          }),
    }),
  };
}

describe("the owner's images in a turn", () => {
  it("go to a main model that reads images, before the text of their message", async () => {
    const { turn, main } = imageTurn({
      taken: withImages("What is this?", ["tg:chart", "tg:photo"]),
      mainReads: true,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 1 });
    expect(main.requests[0]?.messages.at(-1)).toStrictEqual({
      role: "owner",
      text: "What is this?",
      images: [chart, photo],
    });
  });

  it("go to the vision model when the main one reads none; the main one gets each description", async () => {
    const vision = createScriptedTransport([textReply("A price chart."), textReply("A cat.")]);
    const { turn, main, recorder } = imageTurn({
      taken: withImages("Buy it?", ["tg:chart", "tg:photo"]),
      mainReads: false,
      vision,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(vision.requests.map((request) => request.messages[0])).toMatchObject([
      { role: "owner", images: [chart] },
      { role: "owner", images: [photo] },
    ]);
    expect(main.requests[0]?.messages.slice(-3)).toStrictEqual([
      { role: "owner", text: "Buy it?" },
      { role: "owner", text: describedImageNote(1, "A price chart.") },
      { role: "owner", text: describedImageNote(2, "A cat.") },
    ]);
    expect(recorder.steps.filter((step) => step.kind === "described")).toStrictEqual([
      { kind: "described", message: "msg_1", place: 1, text: "A price chart." },
      { kind: "described", message: "msg_1", place: 2, text: "A cat." },
    ]);
    expect(recorder.steps.filter((step) => step.kind === "usage")).toMatchObject([
      { model: "test/eyes" },
      { model: "test/eyes" },
      { model: "test/model" },
    ]);
  });

  it("end the turn with the line that names the vision model setting when no model reads them", async () => {
    const { turn, main, recorder } = imageTurn({
      taken: withImages("Look", ["tg:chart"]),
      mainReads: false,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed", modelCalls: 0 });
    expect(main.requests).toStrictEqual([]);
    expect(statusOf(recorder.steps)).toStrictEqual([
      { kind: "status", line: { line: "image", problem: "noVision" } },
      { kind: "journalEnd", outcome: "failed", heldBack: 0 },
    ]);
  });

  it.each([
    ["over 5 MiB", ["tg:chart", "tg:huge"], "tooLarge"],
    ["in a format the agent cannot read", ["tg:gif"], "format"],
    ["gone from the engine", ["tg:gone"], "unreadable"],
    [
      "five in one message",
      ["tg:chart", "tg:chart", "tg:chart", "tg:chart", "tg:photo"],
      "tooMany",
    ],
  ] as const)("are refused %s before any model call", async (_case, images, problem) => {
    const vision = createScriptedTransport([textReply("never")]);
    const { turn, main, recorder } = imageTurn({
      taken: withImages("Look", images),
      mainReads: true,
      vision,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed", modelCalls: 0 });
    expect([main.requests.length, vision.requests.length]).toStrictEqual([0, 0]);
    expect(statusOf(recorder.steps)[0]).toStrictEqual({
      kind: "status",
      line: { line: "image", problem },
    });
  });

  it("start the turn marked as outside content", async () => {
    const { turn, recorder } = imageTurn({
      taken: withImages("Look", ["tg:chart"]),
      mainReads: true,
    });
    await turn.run();
    expect(recorder.steps.find((step) => step.kind === "start")).toMatchObject({ outside: true });
  });

  it("skip a fallback model that reads no images", async () => {
    const reading = createScriptedTransport([
      [{ type: "error", failure: "request", message: "refused" }],
    ]);
    const blind = createScriptedTransport([textReply("never")]);
    const { turn } = createTestTurn({
      replies: [],
      taken: [withImages("Look", ["tg:chart"])],
      readImage: reader(),
      models: (clock) =>
        createTestChain(
          [
            { name: "test/model", transport: reading, readsImages: true },
            { name: "other/blind", transport: blind },
          ],
          { clock },
        ),
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed" });
    expect(blind.requests).toStrictEqual([]);
  });
});
