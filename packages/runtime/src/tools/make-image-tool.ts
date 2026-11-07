import type { Clock, Random } from "@binference/core";
import {
  imagePartBytes,
  maxImageBytes,
  maxImagePromptChars,
  maxImagesPerMessage,
} from "@binference/protocol";
import { z } from "zod";
import type { ImageJobs, RunningImageJob } from "../images/image-jobs.js";
import type { ToolOutcome } from "../loop/turn-records.js";
import type { ImageMaker, ImageMakingRequest } from "../providers/image-making.js";
import { type ModelPrice } from "../usage/model-price.js";
import { usageCost } from "../usage/usage-amount.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { imageReadFailed, placeOfName, readImages } from "./image-places.js";
import type { AgentToolParts } from "./tool-client.js";

/** What the image tool runs on: the agents' jobs, the model, its price, ids and time. */
export interface ImageMakingToolParts {
  readonly jobs: ImageJobs;
  /** The model that makes images, or why there is none, in a line the agent reads. */
  readonly maker: ImageMaker | string;
  /** The image model's price, for the usage a job books; without one it books $0. */
  readonly price?: ModelPrice;
  readonly random: Random;
  readonly clock: Clock;
}

/** The args of `make_image`: what to make, from which images, and how. */
interface MakeImageArgs {
  readonly action?: "make" | "status";
  readonly prompt?: string;
  readonly images?: readonly string[];
  readonly count?: number;
  readonly size?: ImageMakingRequest["size"];
  readonly quality?: ImageMakingRequest["quality"];
  readonly outputFormat?: ImageMakingRequest["outputFormat"];
  readonly background?: ImageMakingRequest["background"];
}

const makeArgs: z.ZodType<MakeImageArgs> = z.strictObject({
  action: z.enum(["make", "status"]).exactOptional(),
  prompt: z.string().trim().min(1).max(maxImagePromptChars).exactOptional(),
  images: z.array(z.string().trim().min(1)).max(maxImagesPerMessage).exactOptional(),
  count: z.int().min(1).max(maxImagesPerMessage).exactOptional(),
  size: z.enum(["1024x1024", "1536x1024", "1024x1536", "auto"]).exactOptional(),
  quality: z.enum(["low", "medium", "high", "auto"]).exactOptional(),
  outputFormat: z.enum(["png", "jpeg", "webp"]).exactOptional(),
  background: z.enum(["transparent", "opaque", "auto"]).exactOptional(),
});

/** One job: the agent and turn it serves, its id, and what the model was asked. */
interface JobRun {
  readonly parts: AgentToolParts;
  readonly imaging: ImageMakingToolParts;
  readonly maker: ImageMaker;
  readonly id: string;
  readonly request: ImageMakingRequest;
}

// How long a job may run in all: the model's 5 minutes, and time to send what it made.
const jobMs = 7 * 60_000;

function runningText(job: RunningImageJob, clock: Clock): string {
  const minutes = String(Math.floor((clock.now() - job.startedAtMs) / 60_000));
  const what = job.count === 1 ? "an image" : `${String(job.count)} images`;
  return `Making ${what} for "${job.prompt}" for ${minutes} min now. They arrive in a later turn on their own; never call make_image again for this request.`;
}

// Sends one made image to the engine in parts; answers its id once the engine saved it.
async function sent(
  run: JobRun,
  made: { readonly place: number; readonly bytes: Uint8Array },
  signal: AbortSignal,
): Promise<string | undefined> {
  const { agent, client } = run.parts;
  const total = made.bytes.byteLength;
  let image: string | undefined;
  for (let offset = 0; offset < total; offset += imagePartBytes) {
    const data = Buffer.from(made.bytes.subarray(offset, offset + imagePartBytes)).toString(
      "base64",
    );
    const args = { agent, job: run.id, place: made.place, offset, total, data };
    // oxlint-disable-next-line eslint/no-await-in-loop -- the engine takes the parts in order
    const stored = await client.call("image/store", args, { signal });
    image = stored.image;
  }
  return image;
}

// Books the job's usage on the turn that started it, so the day's budget counts it.
async function booked(
  run: JobRun,
  outcome: Awaited<ReturnType<ImageMaker["make"]>>,
  signal: AbortSignal,
): Promise<void> {
  if (!outcome.ok || outcome.usage === undefined) {
    return;
  }
  const { agent, client, turn } = run.parts;
  const { usage } = outcome;
  const { usdMicros } = usageCost(usage, run.imaging.price);
  const args = {
    agent,
    turn: turn.turn,
    model: run.maker.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    usdMicros,
  };
  await client.call("usage/record", args, { signal, key: `image:${run.id}` });
}

// Makes the images, sends each to the engine, and tells the engine how the job ended.
async function runJob(run: JobRun): Promise<void> {
  const signal = AbortSignal.timeout(jobMs);
  const outcome = await run.maker.make(run.request, signal);
  await booked(run, outcome, signal);
  const ids: string[] = [];
  let failed = outcome.ok ? undefined : outcome.failure;
  for (const [place, bytes] of (outcome.ok ? outcome.images : []).entries()) {
    if (bytes.byteLength > maxImageBytes) {
      failed = "an image was over 5 MiB; ask for JPEG or WebP, or a smaller size";
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one image crosses at a time
    const image = await sent(run, { place, bytes }, signal);
    ids.push(...(image === undefined ? [] : [image]));
  }
  const { agent, client, turn } = run.parts;
  const ended = {
    agent,
    session: turn.session,
    turn: turn.turn,
    surface: turn.surface ?? "console",
    prompt: run.request.prompt,
    images: ids,
    ...(ids.length === 0 && failed !== undefined ? { failed } : {}),
  };
  await client.call("image/made", ended, { signal });
}

const started = (count: number): ToolOutcome => ({
  text: `Making ${count === 1 ? "the image" : `${String(count)} images`} now. They arrive in a later turn on their own, where you say they are ready; in this turn say at most one short line that you are making them, then end. Never call make_image again for this request.`,
  isError: false,
});

// What the model is asked: the call's prompt and options, one PNG unless it names others.
function requestOf(
  args: MakeImageArgs & { readonly prompt: string },
  references: ImageMakingRequest["references"],
): ImageMakingRequest {
  return {
    prompt: args.prompt,
    count: args.count ?? 1,
    outputFormat: args.outputFormat ?? "png",
    references,
    ...(args.size === undefined ? {} : { size: args.size }),
    ...(args.quality === undefined ? {} : { quality: args.quality }),
    ...(args.background === undefined ? {} : { background: args.background }),
  };
}

async function make(
  parts: AgentToolParts,
  imaging: ImageMakingToolParts,
  call: { readonly args: MakeImageArgs; readonly signal: AbortSignal },
): Promise<ToolOutcome> {
  const { args, signal } = call;
  const { maker, jobs, clock } = imaging;
  const running = jobs.running(parts.agent);
  if (running !== undefined) {
    return { text: runningText(running, clock), isError: false };
  }
  if (typeof maker === "string" || args.prompt === undefined) {
    return {
      text: typeof maker === "string" ? maker : "Name what to make in prompt.",
      isError: true,
    };
  }
  const read = await readImages(parts, (args.images ?? []).map(placeOfName), signal);
  if (!read.ok) {
    return imageReadFailed(read.error);
  }
  const references = read.value.map(({ contentType, data }) => ({
    contentType,
    bytes: Buffer.from(data, "base64"),
  }));
  const request = requestOf({ ...args, prompt: args.prompt }, references);
  const { count } = request;
  const id = Buffer.from(imaging.random.bytes(8)).toString("hex");
  const job = { prompt: args.prompt, count, startedAtMs: clock.now() };
  jobs.start(parts.agent, job, async () => runJob({ parts, imaging, maker, id, request }));
  return started(count);
}

/**
 * `make_image`, a control tool (decision 0392): makes 1 to 4 images with the model of
 * `models.imageMaking`, new or from up to 4 reference images, after the call answers, so the turn
 * ends while the model works. The images reach the owner's chat, saved in the agent's workspace,
 * and their end starts the agent's next turn. One job runs per agent; `action: "status"` names it.
 */
export function makeImageTool(parts: AgentToolParts, imaging: ImageMakingToolParts): AgentTool {
  return defineTool({
    name: "make_image",
    kind: "control",
    description: agentToolTexts.make_image,
    args: makeArgs,
    run: async (args, { signal }) => {
      if (args.action === "status") {
        const running = imaging.jobs.running(parts.agent);
        return {
          text: running === undefined ? "No image job runs." : runningText(running, imaging.clock),
          isError: false,
        };
      }
      return make(parts, imaging, { args, signal });
    },
  });
}
