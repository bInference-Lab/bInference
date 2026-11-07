import { createIdSource, err, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createMemoryAgentInboxStore } from "../fakes/memory-agent-inbox-store.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryFiles, memoryFilePlaces } from "../fakes/memory-files.js";
import type { MachineFiles } from "../files/ports.js";
import { expectOk, testAgent, testAgentDraft } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createMadeImageHandlers } from "./made-images.js";
import { createRunningTurns } from "./running-turns.js";
import { testPng } from "./test-images.js";

const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const runtime = testCallers.runtime;
const png = Buffer.from(testPng);

async function setUp(given: { readonly files?: "none" | MachineFiles } = {}) {
  const clock = createManualClock(Date.UTC(2026, 10, 7, 12));
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft({}), testCall({}));
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const pushes: EnginePush[] = [];
  const files = typeof given.files === "object" ? given.files : createMemoryFiles();
  const handlers = createMadeImageHandlers({
    agentInbox: createMemoryAgentInboxStore({ agents }),
    turns,
    ids: createIdSource({ clock, random: createSeededRandom(1) }),
    clock,
    random: createSeededRandom(2),
    publish: (push) => pushes.push(push),
    intentView: async () => Promise.resolve(undefined),
    ...(given.files === "none" ? {} : { madeImageFiles: files }),
  });
  // Stores the image in parts of `size` bytes, as the runtime sends them.
  const store = async (bytes: Readonly<Uint8Array>, size: number, place = 0) => {
    const answers = [];
    for (let offset = 0; offset < bytes.byteLength; offset += size) {
      const data = Buffer.from(bytes.subarray(offset, offset + size)).toString("base64");
      const args = {
        agent: testAgent,
        job: "job1abcd",
        place,
        offset,
        total: bytes.byteLength,
        data,
      };
      // oxlint-disable-next-line eslint/no-await-in-loop -- parts go in order
      answers.push(await handlers["image/store"](testCall(args, runtime)));
    }
    return answers;
  };
  return { handlers, store, pushes, files };
}

// The last of a list that holds at least one.
function lastOf<T>(items: readonly T[]): T {
  const last = items.at(-1);
  if (last === undefined) {
    throw new Error("The list is empty.");
  }
  return last;
}

describe("the images the agent makes", () => {
  it("saves an image sent in parts in the workspace, shows it on the chat topic and wakes the agent", async () => {
    const test = await setUp();
    const answers = await test.store(png, 20);
    expect(answers.slice(0, -1)).toStrictEqual(
      Array.from({ length: answers.length - 1 }, () => ({ ok: true, value: {} })),
    );
    const saved = expectOk(lastOf(answers));
    expect(saved.path).toMatch(
      new RegExp(`^${memoryFilePlaces.workspace}/media/made/2026-11-07/[0-9a-f]{16}\\.png$`, "u"),
    );
    const image = String(saved.image);
    const made = {
      agent: testAgent,
      session,
      turn,
      surface: "console" as const,
      prompt: "A frog logo.",
      images: [image],
    };
    expectOk(await test.handlers["image/made"](testCall(made, runtime)));
    expect(test.pushes.find((push) => push.kind === "chat/images")).toMatchObject({
      topic: `chat:${testAgent}`,
      data: {
        turn,
        prompt: "A frog logo.",
        images: [{ image, contentType: "image/png", bytes: png.byteLength }],
      },
    });
    const woken = JSON.stringify(test.pushes.filter((push) => push.topic === "inbox"));
    expect(woken).toContain('the image you made for \\"A frog logo.\\" is ready');
    const part = expectOk(
      await test.handlers["image/read"](testCall({ agent: testAgent, image }, testCallers.cli)),
    );
    expect(Buffer.from(part.data, "base64").equals(png)).toBe(true);
  });

  it("wakes the agent with why no image was made, and shows nothing", async () => {
    const test = await setUp();
    const made = {
      agent: testAgent,
      session,
      turn,
      surface: "cli" as const,
      prompt: "A frog.",
      images: [],
      failed: "the model refused the prompt",
    };
    expectOk(await test.handlers["image/made"](testCall(made, runtime)));
    expect(test.pushes.some((push) => push.kind === "chat/images")).toBe(false);
    expect(JSON.stringify(test.pushes)).toContain("failed: the model refused the prompt");
  });

  it("refuses a part out of order, a file that is no image, an unknown image, and every caller but the runtime", async () => {
    const test = await setUp();
    const late = { agent: testAgent, job: "job1abcd", place: 0, offset: 4, total: 8, data: "AAAA" };
    expect(await test.handlers["image/store"](testCall(late, runtime))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    const [text] = await test.store(Buffer.from("not an image"), 64);
    expect(text).toStrictEqual({ ok: false, error: "image.format" });
    const made = {
      agent: testAgent,
      session,
      turn,
      surface: "cli" as const,
      prompt: "x",
      images: ["ffffffffffffffff"],
    };
    expect(await test.handlers["image/made"](testCall(made, runtime))).toStrictEqual({
      ok: false,
      error: "image.not_found",
    });
    expect(await test.handlers["image/made"](testCall(made, testCallers.cli))).toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    expect(await test.handlers["image/store"](testCall(late, testCallers.cli))).toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    expect(
      await test.handlers["image/read"](
        testCall({ agent: testAgent, image: "ffffffffffffffff" }, testCallers.cli),
      ),
    ).toStrictEqual({ ok: false, error: "image.not_found" });
  });

  it("refuses to store an image on an engine with no files", async () => {
    const test = await setUp({ files: "none" });
    const [only] = await test.store(png, png.byteLength);
    expect(only).toStrictEqual({ ok: false, error: "image.unreadable" });
  });

  it("names how many images two are, and the reason no image came back when the runtime gave none", async () => {
    const test = await setUp();
    const first = expectOk(lastOf(await test.store(png, png.byteLength, 0)));
    const second = expectOk(lastOf(await test.store(png, png.byteLength, 1)));
    const both = [String(first.image), String(second.image)];
    const made = {
      agent: testAgent,
      session,
      turn,
      surface: "cli" as const,
      prompt: "Two frogs.",
      images: both,
    };
    expectOk(await test.handlers["image/made"](testCall(made, runtime)));
    const none = { ...made, prompt: "Nothing.", images: [] };
    expectOk(await test.handlers["image/made"](testCall(none, runtime)));
    const words = JSON.stringify(test.pushes);
    expect(words).toContain("the 2 images you made");
    expect(words).toContain("failed: no image came back");
  });

  it("refuses an image the workspace would not take, and an agent the inbox does not hold", async () => {
    const refusing: MachineFiles = {
      ...createMemoryFiles(),
      write: async () => Promise.resolve(err("unwritable")),
    };
    const test = await setUp({ files: refusing });
    expect(await test.store(png, png.byteLength)).toStrictEqual([
      { ok: false, error: "image.unreadable" },
    ]);
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    const made = {
      agent: stranger,
      session,
      turn,
      surface: "cli" as const,
      prompt: "x",
      images: [],
    };
    expect(await test.handlers["image/made"](testCall(made, runtime))).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
  });

  it("refuses to read a saved image whose file is gone, or from past its end", async () => {
    const test = await setUp();
    const saved = expectOk(lastOf(await test.store(png, png.byteLength)));
    const image = String(saved.image);
    const past = { agent: testAgent, image, offset: png.byteLength };
    expect(await test.handlers["image/read"](testCall(past, testCallers.cli))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    await test.files.remove(String(saved.path), {
      signal: new AbortController().signal,
      workspaceOnly: true,
    });
    expect(
      await test.handlers["image/read"](testCall({ agent: testAgent, image }, testCallers.cli)),
    ).toStrictEqual({
      ok: false,
      error: "image.not_found",
    });
  });
});
