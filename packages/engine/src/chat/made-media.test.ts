import { createIdSource, err, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { maxVoiceBytes, mediaPartBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFakeLocalVoice } from "../fakes/fake-local-voice.js";
import { createMemoryAgentInboxStore } from "../fakes/memory-agent-inbox-store.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryFiles, memoryFilePlaces } from "../fakes/memory-files.js";
import type { MachineFiles } from "../files/ports.js";
import { expectOk, testAgent, testAgentDraft } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import type { LocalVoice } from "../speech/ports.js";
import { createInboxHold } from "./inbox-hold.js";
import { createMadeMediaHandlers } from "./made-media.js";
import { createRunningTurns } from "./running-turns.js";

const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const runtime = testCallers.runtime;
const owner = testCallers.cli;

// An MP4's opening `ftyp` box, then `size` bytes in all.
function mp4(size: number): Buffer {
  const bytes = Buffer.alloc(size, 7);
  Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(bytes);
  return bytes;
}

const ogg = Buffer.from("OggS and some opus pages");

interface SetUp {
  readonly files?: "none" | MachineFiles;
  readonly voice?: LocalVoice;
}

async function setUp(given: SetUp = {}) {
  const clock = createManualClock(Date.UTC(2026, 10, 8, 12));
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft({}), testCall({}));
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const pushes: EnginePush[] = [];
  const files = typeof given.files === "object" ? given.files : createMemoryFiles();
  const handlers = createMadeMediaHandlers({
    agentInbox: createMemoryAgentInboxStore({ agents }),
    inboxHold: createInboxHold(),
    turns,
    ids: createIdSource({ clock, random: createSeededRandom(1) }),
    clock,
    random: createSeededRandom(2),
    publish: (push) => pushes.push(push),
    intentView: async () => Promise.resolve(undefined),
    ...(given.files === "none" ? {} : { madeImageFiles: files }),
    ...(given.voice === undefined ? {} : { localVoice: given.voice }),
  });
  // Stores the medium in parts of `size` bytes, as the runtime sends them.
  const store = async (bytes: Readonly<Uint8Array>, kind: "video" | "voice", size: number) => {
    const answers = [];
    for (let offset = 0; offset < bytes.byteLength; offset += size) {
      const data = Buffer.from(bytes.subarray(offset, offset + size)).toString("base64");
      const args = {
        agent: testAgent,
        job: "job1abcd",
        kind,
        offset,
        total: bytes.byteLength,
        data,
      };
      // oxlint-disable-next-line eslint/no-await-in-loop -- parts go in order
      answers.push(await handlers["media/store"](testCall(args, runtime)));
    }
    return answers;
  };
  return { handlers, store, pushes, files, clock };
}

// The medium the last answer saved.
function savedOf(answers: readonly unknown[]) {
  const last = answers.at(-1);
  const value = expectOk(last as Parameters<typeof expectOk>[0]) as {
    readonly media?: { readonly media: string; readonly path: string };
  };
  if (value.media === undefined) {
    throw new Error("Nothing was saved.");
  }
  return value.media;
}

const made = { agent: testAgent, session, turn, surface: "telegram" as const, prompt: "A boat." };

describe("the videos and speech the agent makes", () => {
  it("saves a video sent in parts, shows it on the chat topic, wakes the agent and reads it back in parts", async () => {
    const test = await setUp();
    const video = mp4(mediaPartBytes + 1_000);
    const answers = await test.store(video, "video", 300_000);
    expect(answers.slice(0, -1)).toStrictEqual([{ ok: true, value: {} }]);
    const saved = savedOf(answers);
    expect(saved.path).toMatch(
      new RegExp(`^${memoryFilePlaces.workspace}/media/made/2026-11-08/[0-9a-f]{16}\\.mp4$`, "u"),
    );
    expectOk(await test.handlers["media/made"](testCall({ ...made, media: saved.media }, runtime)));
    expect(test.pushes.find((push) => push.kind === "chat/media")).toMatchObject({
      topic: `chat:${testAgent}`,
      data: { turn, media: { media: saved.media, kind: "video", contentType: "video/mp4" } },
    });
    expect(JSON.stringify(test.pushes)).toContain('the video you made for \\"A boat.\\" is ready');
    const read = { agent: testAgent, media: saved.media };
    const first = expectOk(await test.handlers["media/read"](testCall(read, owner)));
    expect(first).toMatchObject({ contentType: "video/mp4", offset: 0, next: mediaPartBytes });
    const second = expectOk(
      await test.handlers["media/read"](testCall({ ...read, offset: mediaPartBytes }, owner)),
    );
    const whole = Buffer.concat([
      Buffer.from(first.data, "base64"),
      Buffer.from(second.data, "base64"),
    ]);
    expect(whole.equals(video)).toBe(true);
    expect(second.next).toBeUndefined();
  });

  it("wakes the agent with why no video was made, and shows nothing", async () => {
    const test = await setUp();
    const failed = { ...made, failed: "the model refused the prompt" };
    expectOk(await test.handlers["media/made"](testCall(failed, runtime)));
    expectOk(await test.handlers["media/made"](testCall(made, runtime)));
    expect(test.pushes.some((push) => push.kind === "chat/media")).toBe(false);
    const words = JSON.stringify(test.pushes);
    expect(words).toContain("failed: the model refused the prompt");
    expect(words).toContain("failed: no video came back");
  });

  it("saves speech by its format and sends it with no wake-up", async () => {
    const test = await setUp();
    const saved = savedOf(await test.store(ogg, "voice", 1_000));
    expect(saved.path).toMatch(/\/media\/speech\/2026-11-08\/[0-9a-f]{16}\.ogg$/u);
    const sent = { agent: testAgent, turn, media: saved.media };
    expectOk(await test.handlers["media/send"](testCall(sent, runtime)));
    expect(test.pushes.map((push) => push.kind)).toStrictEqual(["chat/media"]);
    expect(test.pushes[0]?.data).toMatchObject({
      media: { kind: "voice", contentType: "audio/ogg" },
    });
    expect(
      await test.handlers["media/made"](testCall({ ...made, media: saved.media }, runtime)),
    ).toStrictEqual({ ok: false, error: "media.not_found" });
  });

  it("speaks with the machine's voice, saves the words as M4A, and refuses without a voice", async () => {
    const voice = createFakeLocalVoice();
    const test = await setUp({ voice });
    const args = { agent: testAgent, text: "Your buy filled.", voice: "Samantha" };
    const spoken = expectOk(await test.handlers["speech/local"](testCall(args, runtime)));
    expect(spoken.media?.path).toMatch(/\/media\/speech\/2026-11-08\/[0-9a-f]{16}\.m4a$/u);
    expect(voice.spoken).toStrictEqual([{ text: "Your buy filled.", voice: "Samantha" }]);
    const plain = { agent: testAgent, text: "Again." };
    expectOk(await test.handlers["speech/local"](testCall(plain, runtime)));
    expect(voice.spoken.at(-1)).toStrictEqual({ text: "Again." });
    const mute = await setUp({ voice: createFakeLocalVoice({ mute: true }) });
    expect(await mute.handlers["speech/local"](testCall(args, runtime))).toStrictEqual({
      ok: false,
      error: "speech.local_unavailable",
    });
    const none = await setUp();
    expect(await none.handlers["speech/local"](testCall(args, runtime))).toStrictEqual({
      ok: false,
      error: "speech.local_unavailable",
    });
    const failing: LocalVoice = { speak: async () => Promise.resolve(err("failed")) };
    const broken = await setUp({ voice: failing });
    expect(await broken.handlers["speech/local"](testCall(args, runtime))).toStrictEqual({
      ok: false,
      error: "speech.failed",
    });
  });

  it("refuses a part out of order, a stale arrival, too large speech, the wrong format and an unknown medium", async () => {
    const test = await setUp();
    const late = {
      agent: testAgent,
      job: "job1abcd",
      kind: "video" as const,
      offset: 4,
      total: 8,
      data: "AAAA",
    };
    expect(await test.handlers["media/store"](testCall(late, runtime))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    const video = mp4(40);
    const head = Buffer.from(video.subarray(0, 20)).toString("base64");
    const tail = Buffer.from(video.subarray(20)).toString("base64");
    const part = { agent: testAgent, job: "job2abcd", kind: "video" as const, total: 40 };
    expectOk(
      await test.handlers["media/store"](testCall({ ...part, offset: 0, data: head }, runtime)),
    );
    await test.clock.advance(16 * 60_000);
    expect(
      await test.handlers["media/store"](testCall({ ...part, offset: 20, data: tail }, runtime)),
    ).toStrictEqual({ ok: false, error: "protocol.bad_args" });
    const huge = { ...late, kind: "voice" as const, offset: 0, total: maxVoiceBytes + 1 };
    expect(await test.handlers["media/store"](testCall(huge, runtime))).toStrictEqual({
      ok: false,
      error: "media.too_large",
    });
    expect(await test.store(ogg, "video", 1_000)).toStrictEqual([
      { ok: false, error: "media.format" },
    ]);
    const unknown = { agent: testAgent, turn, media: "ffffffffffffffff" };
    expect(await test.handlers["media/send"](testCall(unknown, runtime))).toStrictEqual({
      ok: false,
      error: "media.not_found",
    });
    expect(
      await test.handlers["media/read"](
        testCall({ agent: testAgent, media: unknown.media }, owner),
      ),
    ).toStrictEqual({ ok: false, error: "media.not_found" });
  });

  it("answers only the runtime it runs now", async () => {
    const test = await setUp({ voice: createFakeLocalVoice() });
    const refused = { ok: false, error: "auth.scope" };
    const store = {
      agent: testAgent,
      job: "job1abcd",
      kind: "video" as const,
      offset: 0,
      total: 8,
      data: "AAAA",
    };
    expect(await test.handlers["media/store"](testCall(store, owner))).toStrictEqual(refused);
    expect(await test.handlers["media/made"](testCall(made, owner))).toStrictEqual(refused);
    const send = { agent: testAgent, turn, media: "ffffffffffffffff" };
    expect(await test.handlers["media/send"](testCall(send, owner))).toStrictEqual(refused);
    const speak = { agent: testAgent, text: "Hello." };
    expect(await test.handlers["speech/local"](testCall(speak, owner))).toStrictEqual(refused);
  });

  it("refuses to save on an engine with no files or a workspace that refuses, and an agent the inbox lacks", async () => {
    const none = await setUp({ files: "none" });
    expect(await none.store(ogg, "voice", 1_000)).toStrictEqual([
      { ok: false, error: "media.unreadable" },
    ]);
    const refusing: MachineFiles = {
      ...createMemoryFiles(),
      write: async () => Promise.resolve(err("unwritable")),
    };
    const test = await setUp({ files: refusing });
    expect(await test.store(ogg, "voice", 1_000)).toStrictEqual([
      { ok: false, error: "media.unreadable" },
    ]);
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
    expect(
      await test.handlers["media/made"](testCall({ ...made, agent: stranger }, runtime)),
    ).toStrictEqual({ ok: false, error: "agent.not_found" });
  });

  it("refuses to read a saved medium whose file is gone, or from past its end", async () => {
    const test = await setUp();
    const saved = savedOf(await test.store(ogg, "voice", 1_000));
    const past = { agent: testAgent, media: saved.media, offset: ogg.byteLength };
    expect(await test.handlers["media/read"](testCall(past, owner))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    await test.files.remove(saved.path, {
      signal: new AbortController().signal,
      workspaceOnly: true,
    });
    await test.clock.advance(3 * 60_000);
    const read = { agent: testAgent, media: saved.media };
    expect(await test.handlers["media/read"](testCall(read, owner))).toStrictEqual({
      ok: false,
      error: "media.not_found",
    });
  });
});
