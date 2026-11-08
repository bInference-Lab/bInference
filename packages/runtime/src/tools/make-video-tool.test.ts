import { BinferenceError } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { ImageJobs } from "../images/image-jobs.js";
import type { VideoMakingRequest } from "../providers/gateway-video-body.js";
import type { VideoMaker, VideoMakingOutcome } from "../providers/gateway-video-making.js";
import { agent, context, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { makeVideoTool, type RunningVideoJob } from "./make-video-tool.js";

const mp4 = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const saved = {
  media: "d4e5f60718293a4b",
  kind: "video",
  contentType: "video/mp4",
  bytes: mp4.byteLength,
  path: "/owner/.binference/workspace/media/made/2026-11-08/d4e5f60718293a4b.mp4",
};

// Jobs that run each job's work at once, keep its promise for the test to wait on, and say one runs.
function heldJobs(running?: RunningVideoJob) {
  const works: Promise<void>[] = [];
  const jobs: ImageJobs<RunningVideoJob> = {
    running: () => running,
    start: (_agent, _job, work) => {
      works.push(work());
      return true;
    },
  };
  return { jobs, ended: async () => Promise.all(works) };
}

// A model that answers every request with `outcome`, and keeps what it was asked and its keys.
function modelOf(outcome: VideoMakingOutcome) {
  const asked: { readonly request: VideoMakingRequest; readonly key: string }[] = [];
  const maker: VideoMaker = {
    model: "binference/alibaba/wan-3.0",
    make: async (request, call) => {
      asked.push({ request, key: call.key });
      return Promise.resolve(outcome);
    },
  };
  return { maker, asked };
}

function toolOn(
  answers: Readonly<Record<string, FakeAnswer>>,
  making: { readonly maker: VideoMaker | string; readonly running?: RunningVideoJob },
) {
  const client = createFakeToolClient(answers);
  const held = heldJobs(making.running);
  const clock = createManualClock(1_760_000_000_000);
  const tool = makeVideoTool(
    { agent, client, turn: { ...toolTurn, surface: "telegram" } },
    { jobs: held.jobs, maker: making.maker, random: createSeededRandom(3), clock },
  );
  const run = async (args: object) => {
    const prepared = tool.prepare(JSON.stringify(args));
    if (!prepared.ready) {
      throw new Error(prepared.text);
    }
    return prepared.run(context);
  };
  return { run, client, ended: held.ended };
}

const engine = {
  "media/store": { media: saved },
  "media/made": {},
  "usage/record": { budgetLeftMicros: "1000000" },
};

describe("the make_video tool", () => {
  it("starts the job, ends the call at once, then books its charge and sends the video to the engine", async () => {
    const model = modelOf({ ok: true, video: mp4, costMicros: 600_000n });
    const chat = toolOn(engine, { maker: model.maker });
    const outcome = await chat.run({
      prompt: "A paper boat on a pond.",
      seconds: 6,
      firstFrame: "https://pictures.example.test/boat.png",
    });
    expect(outcome).toMatchObject({ isError: false, closingLine: "videoComing" });
    await chat.ended();
    expect(model.asked).toStrictEqual([
      {
        request: {
          prompt: "A paper boat on a pond.",
          seconds: 6,
          firstFrame: "https://pictures.example.test/boat.png",
          references: [],
        },
        key: expect.stringMatching(/^[0-9a-f]{16}$/u) as string,
      },
    ]);
    const calls = chat.client.calls();
    expect(calls.map((call) => call.op)).toStrictEqual([
      "usage/record",
      "media/store",
      "media/made",
    ]);
    expect(calls[0]).toMatchObject({
      args: { model: "binference/alibaba/wan-3.0", usdMicros: "600000", inputTokens: 0 },
    });
    expect(calls[0]?.key).toBe(`video:${String(model.asked[0]?.key)}`);
    expect(calls[1]?.args).toMatchObject({ kind: "video", offset: 0, total: mp4.byteLength });
    expect(calls[2]?.args).toMatchObject({
      surface: "telegram",
      prompt: "A paper boat on a pond.",
      media: saved.media,
    });
  });

  it("tells the engine why no video came, and why one could not be kept", async () => {
    const failing = toolOn(engine, {
      maker: modelOf({ ok: false, failure: "the video failed" }).maker,
    });
    await failing.run({ prompt: "A boat." });
    await failing.ended();
    expect(failing.client.calls()).toMatchObject([
      { op: "media/made", args: { failed: "the video failed" } },
    ]);
    const tooLarge = new BinferenceError({ code: "media.too_large", message: "Too large." });
    const refusing = toolOn(
      { ...engine, "media/store": tooLarge },
      { maker: modelOf({ ok: true, video: mp4 }).maker },
    );
    await refusing.run({ prompt: "A boat." });
    await refusing.ended();
    expect(refusing.client.calls().map((call) => call.op)).toStrictEqual([
      "media/store",
      "media/made",
    ]);
    expect(JSON.stringify(refusing.client.calls()[1]?.args)).toContain("over 100 MiB");
    const broken = toolOn(
      { ...engine, "media/store": new Error("closed") },
      { maker: modelOf({ ok: true, video: mp4 }).maker },
    );
    await broken.run({ prompt: "A boat." });
    await broken.ended();
    expect(JSON.stringify(broken.client.calls()[1]?.args)).toContain("could not be saved");
  });

  it("answers the job that runs instead of starting another, and its status", async () => {
    const running = { prompt: "A boat.", startedAtMs: 1_760_000_000_000 - 180_000 };
    const model = modelOf({ ok: false, failure: "x" });
    const chat = toolOn(engine, { maker: model.maker, running });
    expect((await chat.run({ prompt: "A ship." })).text).toBe(
      'Making a video for "A boat." for 3 min now. It arrives in a later turn on its own; never call make_video again for this request.',
    );
    expect((await chat.run({ action: "status" })).text).toContain('for "A boat."');
    expect(model.asked).toStrictEqual([]);
  });

  it("says which setting to set without a model, asks for a prompt, and refuses a link that is not https", async () => {
    const unset = toolOn(engine, { maker: "No model makes videos: set models.videoMaking." });
    expect(await unset.run({ prompt: "A boat." })).toMatchObject({
      isError: true,
      text: "No model makes videos: set models.videoMaking.",
    });
    const quiet = toolOn(engine, { maker: modelOf({ ok: false, failure: "x" }).maker });
    expect(await quiet.run({})).toMatchObject({
      isError: true,
      text: "Name what happens in the video in prompt.",
    });
    expect((await quiet.run({ action: "status" })).text).toBe("No video job runs.");
    await expect(
      quiet.run({ prompt: "A boat.", firstFrame: "http://pictures.example.test/boat.png" }),
    ).rejects.toThrow(Error);
  });
});
