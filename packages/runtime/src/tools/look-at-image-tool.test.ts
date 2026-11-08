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
    askAbout: async () => Promise.resolve(err("failed")),
    look: async (images, question) => {
      looked.images.push(...images);
      looked.questions.push(question);
      return Promise.resolve(ok("A rising price line."));
    },
  };
}

async function view(
  answer: FakeAnswer,
  args: Record<string, unknown>,
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

  it("reads several images in order and asks the model about them together", async () => {
    const looked: Looked = { images: [], questions: [] };
    const { calls } = await view(
      part,
      { url: "https://example.com/a.png", paths: ["/b.png", "/c.png"] },
      seeingContext(looked),
    );
    expect(calls).toStrictEqual([
      { op: "image/view", args: { agent, url: "https://example.com/a.png" } },
      { op: "image/view", args: { agent, path: "/b.png" } },
      { op: "image/view", args: { agent, path: "/c.png" } },
    ]);
    expect(looked.images).toHaveLength(3);
    expect(looked.questions).toStrictEqual(["What does it show?"]);
  });

  it("reads a file named by a file:// address or a path written with a leading @", async () => {
    const { calls } = await view(part, {
      url: "file:///srv/shots/My%20shot.png",
      paths: ["@/tmp/b.png"],
    });
    expect(calls).toStrictEqual([
      { op: "image/view", args: { agent, path: "/srv/shots/My shot.png" } },
      { op: "image/view", args: { agent, path: "/tmp/b.png" } },
    ]);
  });

  it("reads an image written inside a data: address without asking the engine", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const data = pngBytes.toString("base64");
    const looked: Looked = { images: [], questions: [] };
    const { calls } = await view(
      part,
      { url: `data:image/png;base64,${data}` },
      seeingContext(looked),
    );
    expect(calls).toStrictEqual([]);
    expect(looked.images).toStrictEqual([{ contentType: "image/png", data, bytes: 9 }]);
  });

  it.each([
    ["data:image/png;base64,!!!", "could not be read"],
    [`data:image/png;base64,${Buffer.from("plain text").toString("base64")}`, "PNG, JPEG or WebP"],
  ])("refuses a data: address that holds no image it reads: %s", async (url, words) => {
    const { outcome } = await view(part, { url });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(words);
  });

  it("asks for 1 to 4 images", async () => {
    const none = await view(part, {});
    const five = await view(part, { path: "/a.png", paths: ["/b", "/c", "/d", "/e"] });
    expect([none.outcome, five.outcome]).toStrictEqual([
      { text: "Name 1 to 4 images: url, path or paths.", isError: true },
      { text: "Name 1 to 4 images: url, path or paths.", isError: true },
    ]);
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
      askAbout: async () => Promise.resolve(err("failed")),
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
