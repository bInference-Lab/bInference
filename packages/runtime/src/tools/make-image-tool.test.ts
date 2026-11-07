import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { ImageJobs, RunningImageJob } from "../images/image-jobs.js";
import type {
  ImageMaker,
  ImageMakingOutcome,
  ImageMakingRequest,
} from "../providers/image-making.js";
import { agent, context, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { makeImageTool } from "./make-image-tool.js";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const madeId = "a1b2c3d4e5f60718";

// Jobs that run each job's work at once, keep its promise for the test to wait on, and say one runs.
function heldJobs(running?: RunningImageJob) {
  const works: Promise<void>[] = [];
  const jobs: ImageJobs = {
    running: () => running,
    start: (_agent, _job, work) => {
      works.push(work());
      return true;
    },
  };
  return { jobs, ended: async () => Promise.all(works) };
}

// A model that answers every request with `outcome`, and keeps what it was asked.
function modelOf(outcome: ImageMakingOutcome) {
  const asked: ImageMakingRequest[] = [];
  const maker: ImageMaker = {
    model: "openai/gpt-image-1",
    make: async (request) => {
      asked.push(request);
      return Promise.resolve(outcome);
    },
  };
  return { maker, asked };
}

function toolOn(
  answers: Readonly<Record<string, FakeAnswer>>,
  imaging: { readonly maker: ImageMaker | string; readonly running?: RunningImageJob },
) {
  const client = createFakeToolClient(answers);
  const held = heldJobs(imaging.running);
  const clock = createManualClock(1_760_000_000_000);
  const tool = makeImageTool(
    { agent, client, turn: { ...toolTurn, surface: "telegram" } },
    { jobs: held.jobs, maker: imaging.maker, random: createSeededRandom(3), clock },
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
  "image/store": { image: madeId, path: "/owner/.binference/workspace/media/made/x.png" },
  "image/made": {},
  "usage/record": { budgetLeftMicros: "1000000" },
};

describe("the make_image tool", () => {
  it("starts the job, ends the turn's call at once, then sends the image and its usage to the engine", async () => {
    const model = modelOf({
      ok: true,
      images: [png],
      usage: { inputTokens: 10, outputTokens: 20, cachedTokens: 0 },
    });
    const chat = toolOn(engine, { maker: model.maker });
    const outcome = await chat.run({ prompt: "A frog logo.", size: "1024x1024" });
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain("arrive in a later turn");
    await chat.ended();
    expect(model.asked).toStrictEqual([
      { prompt: "A frog logo.", count: 1, outputFormat: "png", references: [], size: "1024x1024" },
    ]);
    const calls = chat.client.calls();
    expect(calls.map((call) => call.op)).toStrictEqual([
      "usage/record",
      "image/store",
      "image/made",
    ]);
    expect(calls[0]).toMatchObject({ args: { model: "openai/gpt-image-1", outputTokens: 20 } });
    expect(calls[0]?.key).toMatch(/^image:[0-9a-f]{16}$/u);
    expect(calls[2]?.args).toMatchObject({
      surface: "telegram",
      prompt: "A frog logo.",
      images: [madeId],
    });
  });

  it("tells the engine why the model made nothing", async () => {
    const chat = toolOn(engine, {
      maker: modelOf({ ok: false, failure: "the provider said: no" }).maker,
    });
    await chat.run({ prompt: "A frog." });
    await chat.ended();
    expect(chat.client.calls()).toMatchObject([
      { op: "image/made", args: { images: [], failed: "the provider said: no" } },
    ]);
  });

  it("answers the job that runs instead of starting another, and its status", async () => {
    const running = { prompt: "A frog.", count: 2, startedAtMs: 1_760_000_000_000 - 120_000 };
    const model = modelOf({ ok: false, failure: "x" });
    const chat = toolOn(engine, { maker: model.maker, running });
    const again = await chat.run({ prompt: "A toad." });
    expect(again.text).toBe(
      'Making 2 images for "A frog." for 2 min now. They arrive in a later turn on their own; never call make_image again for this request.',
    );
    expect((await chat.run({ action: "status" })).text).toContain('for "A frog."');
    expect(model.asked).toStrictEqual([]);
  });

  it("says which setting to set without a model, and asks for a prompt", async () => {
    const unset = toolOn(engine, { maker: "No model makes images: set models.imageMaking." });
    const unsetAnswer = await unset.run({ prompt: "A frog." });
    expect(unsetAnswer.isError).toBe(true);
    expect(unsetAnswer.text).toContain("models.imageMaking");
    const quiet = toolOn(engine, { maker: modelOf({ ok: false, failure: "x" }).maker });
    expect(await quiet.run({})).toMatchObject({
      isError: true,
      text: "Name what to make in prompt.",
    });
    expect((await quiet.run({ action: "status" })).text).toBe("No image job runs.");
  });

  it("refuses an image over 5 MiB, asking for a smaller format", async () => {
    const huge = new Uint8Array(5 * 1024 * 1024 + 1);
    huge.set(png);
    const chat = toolOn(engine, { maker: modelOf({ ok: true, images: [huge] }).maker });
    await chat.run({ prompt: "A big frog." });
    await chat.ended();
    expect(chat.client.calls()).toMatchObject([{ op: "image/made", args: { images: [] } }]);
    expect(JSON.stringify(chat.client.calls()[0]?.args)).toContain("over 5 MiB");
  });
});
