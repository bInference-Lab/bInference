import { BinferenceError, err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { ModelImage } from "../loop/model-message.js";
import type { ToolOutcome, ToolRunContext } from "../loop/turn-records.js";
import { agent, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { lookAtImageTool } from "./look-at-image-tool.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
const part = { contentType: "image/png", bytes: 4, offset: 0, data: png };

interface Looked {
  readonly images: ModelImage[];
  readonly questions: string[];
}

function seeingContext(looked: Looked): ToolRunContext {
  return {
    signal: new AbortController().signal,
    idempotencyKey: "trn.1",
    look: async (image, question) => {
      looked.images.push(image);
      looked.questions.push(question);
      return Promise.resolve(ok("A rising price line."));
    },
  };
}

async function view(
  answer: FakeAnswer,
  args: Record<string, string>,
  context?: ToolRunContext,
): Promise<{ readonly outcome: ToolOutcome; readonly calls: readonly unknown[] }> {
  const client = createFakeToolClient({ "image/view": answer });
  const prepared = lookAtImageTool({ agent, client, turn: toolTurn }).prepare(JSON.stringify(args));
  if (!prepared.ready) {
    throw new Error(prepared.text);
  }
  const looked = { images: [], questions: [] };
  const outcome = await prepared.run(context ?? seeingContext(looked));
  return { outcome, calls: client.calls() };
}

describe("the look_at_image tool", () => {
  it("reads the image through the engine and answers what a model saw in it, asked the agent's question", async () => {
    const looked: Looked = { images: [], questions: [] };
    const { outcome, calls } = await view(
      part,
      { url: "https://example.com/chart.png", question: "Which way does it trend?" },
      seeingContext(looked),
    );
    expect(calls).toStrictEqual([
      { op: "image/view", args: { agent, url: "https://example.com/chart.png" } },
    ]);
    expect(looked).toStrictEqual({
      images: [{ contentType: "image/png", data: png, bytes: 4 }],
      questions: ["Which way does it trend?"],
    });
    expect(outcome).toStrictEqual({ text: "A rising price line.", isError: false });
  });

  it("reads a file by its path", async () => {
    const { calls } = await view(part, { path: "~/shot.png" });
    expect(calls).toStrictEqual([{ op: "image/view", args: { agent, path: "~/shot.png" } }]);
  });

  it("takes exactly one of url and path", () => {
    const client = createFakeToolClient({});
    const tool = lookAtImageTool({ agent, client, turn: toolTurn });
    const both = JSON.stringify({ url: "https://example.com/a.png", path: "/a.png" });
    expect(tool.prepare(both).ready).toBe(false);
    expect(tool.prepare("{}").ready).toBe(false);
  });

  it.each<[`${string}.${string}`, string]>([
    ["image.walled", "walled off"],
    ["image.not_public", "not on the public internet"],
    ["image.format", "PNG, JPEG or WebP"],
  ])("tells the model why the engine refused with %s", async (code, words) => {
    const refusal = new BinferenceError({ code, message: "Refused." });
    const { outcome } = await view(refusal, { path: "/x.png" });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(words);
  });

  it("says so when no model of the agent can see images", async () => {
    const blind: ToolRunContext = {
      signal: new AbortController().signal,
      idempotencyKey: "trn.1",
      look: async () => Promise.resolve(err("no_model")),
    };
    const { outcome } = await view(part, { path: "/x.png" }, blind);
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.text).toContain("models.imageInput");
  });

  it("marks every answer as outside content", () => {
    const client = createFakeToolClient({});
    const prepared = lookAtImageTool({ agent, client, turn: toolTurn }).prepare(
      JSON.stringify({ path: "/x.png" }),
    );
    expect(prepared).toMatchObject({ ready: true, outside: true });
  });
});
