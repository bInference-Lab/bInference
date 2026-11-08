import type { Clock, Random } from "@binference/core";
import { maxVideoPromptChars } from "@binference/protocol";
import { z } from "zod";
import type { ImageJobs } from "../images/image-jobs.js";
import type { ToolOutcome } from "../loop/turn-records.js";
import type { VideoMakingRequest } from "../providers/gateway-video-body.js";
import type { VideoMaker, VideoMakingOutcome } from "../providers/gateway-video-making.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { storeMedia } from "./store-media.js";
import type { AgentToolParts } from "./tool-client.js";

/** A video job that runs for an agent: what it makes and since when. */
export interface RunningVideoJob {
  readonly prompt: string;
  readonly startedAtMs: number;
}

/** What the video tool runs on: the agents' jobs, the model, ids and time (decision 0405). */
export interface VideoMakingToolParts {
  readonly jobs: ImageJobs<RunningVideoJob>;
  /** The model that makes videos, or why there is none, in a line the agent reads. */
  readonly maker: VideoMaker | string;
  readonly random: Random;
  readonly clock: Clock;
}

/** The args of `make_video`: what to make, how long, how large, and from which pictures. */
interface MakeVideoArgs {
  readonly action?: "make" | "status";
  readonly prompt?: string;
  readonly seconds?: number;
  readonly resolution?: string;
  readonly aspectRatio?: string;
  readonly sound?: boolean;
  readonly seed?: number;
  readonly firstFrame?: string;
  readonly lastFrame?: string;
  readonly references?: readonly string[];
}

const publicLink = z
  .url()
  .regex(/^https:\/\//u)
  .max(2_048);

const makeArgs: z.ZodType<MakeVideoArgs> = z.strictObject({
  action: z.enum(["make", "status"]).exactOptional(),
  prompt: z.string().trim().min(1).max(maxVideoPromptChars).exactOptional(),
  seconds: z.int().min(1).max(120).exactOptional(),
  resolution: z.string().trim().min(2).max(16).exactOptional(),
  aspectRatio: z
    .string()
    .regex(/^\d{1,2}:\d{1,2}$/u)
    .exactOptional(),
  sound: z.boolean().exactOptional(),
  seed: z.int().min(0).max(2_147_483_647).exactOptional(),
  firstFrame: publicLink.exactOptional(),
  lastFrame: publicLink.exactOptional(),
  references: z.array(publicLink).max(4).exactOptional(),
});

/** One job: the agent and turn it serves, its id, and what the model was asked. */
interface JobRun {
  readonly parts: AgentToolParts;
  readonly maker: VideoMaker;
  readonly id: string;
  readonly request: VideoMakingRequest;
}

// How long a job may run in all: 15 minutes of reads, the download and the send to the engine.
const jobMs = 25 * 60_000;

function runningText(job: RunningVideoJob, clock: Clock): string {
  const minutes = String(Math.floor((clock.now() - job.startedAtMs) / 60_000));
  return `Making a video for "${job.prompt}" for ${minutes} min now. It arrives in a later turn on its own; never call make_video again for this request.`;
}

// Books what the gateway charged on the turn that started the job, so the day's budget counts it.
async function booked(run: JobRun, outcome: VideoMakingOutcome, signal: AbortSignal) {
  if (!outcome.ok || outcome.costMicros === undefined) {
    return;
  }
  const { agent, client, turn } = run.parts;
  const args = {
    agent,
    turn: turn.turn,
    model: run.maker.model,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    usdMicros: outcome.costMicros,
  };
  await client.call("usage/record", args, { signal, key: `video:${run.id}` });
}

// Why a failed send to the engine failed, in a line.
const sendFailure = (error: ErrorOptions["cause"]): string =>
  error instanceof Error && "code" in error && error.code === "media.too_large"
    ? "the video is over 100 MiB, which binference does not keep; ask for a shorter or smaller one"
    : "the video could not be saved in your workspace";

// Makes the video, sends it to the engine, and tells the engine how the job ended.
async function runJob(run: JobRun): Promise<void> {
  const signal = AbortSignal.timeout(jobMs);
  const outcome = await run.maker.make(run.request, { key: run.id, signal });
  await booked(run, outcome, signal);
  const job = { job: run.id, kind: "video" as const };
  const saved = outcome.ok
    ? await storeMedia(run.parts, { ...job, bytes: outcome.video }, signal).catch(
        (error: ErrorOptions["cause"]) => sendFailure(error),
      )
    : outcome.failure;
  const { agent, client, turn } = run.parts;
  const ended = {
    agent,
    session: turn.session,
    turn: turn.turn,
    surface: turn.surface ?? "console",
    prompt: run.request.prompt,
    ...(typeof saved === "string" || saved === undefined
      ? { failed: saved ?? "the engine kept no video" }
      : { media: saved.media }),
  };
  await client.call("media/made", ended, { signal });
}

const started: ToolOutcome = {
  closingLine: "videoComing",
  text: "Making the video now; it takes a few minutes. It arrives in a later turn on its own, where you say it is ready; in this turn say at most one short line that you are making it, then end. Never call make_video again for this request.",
  isError: false,
};

// What the model is asked: the call's prompt and values, the rest left to the model's least.
function requestOf(args: MakeVideoArgs & { readonly prompt: string }): VideoMakingRequest {
  const { action: _action, references, ...rest } = args;
  return { ...rest, references: references ?? [] };
}

function make(
  parts: AgentToolParts,
  making: VideoMakingToolParts,
  args: MakeVideoArgs,
): ToolOutcome {
  const { maker, jobs, clock } = making;
  const running = jobs.running(parts.agent);
  if (running !== undefined) {
    return { text: runningText(running, clock), isError: false };
  }
  if (typeof maker === "string" || args.prompt === undefined) {
    return {
      text: typeof maker === "string" ? maker : "Name what happens in the video in prompt.",
      isError: true,
    };
  }
  const request = requestOf({ ...args, prompt: args.prompt });
  const id = Buffer.from(making.random.bytes(8)).toString("hex");
  const job = { prompt: args.prompt, startedAtMs: clock.now() };
  jobs.start(parts.agent, job, async () => runJob({ parts, maker, id, request }));
  return started;
}

/**
 * `make_video`, a control tool (decision 0405): makes one video with the model of
 * `models.videoMaking` on the bInference gateway after the call answers, so the turn ends while the
 * model works for minutes. The video reaches the owner's chat, saved in the agent's workspace, and
 * its end starts the agent's next turn. One job runs per agent; `action: "status"` names it.
 */
export function makeVideoTool(parts: AgentToolParts, making: VideoMakingToolParts): AgentTool {
  return defineTool({
    name: "make_video",
    kind: "control",
    description: agentToolTexts.make_video,
    args: makeArgs,
    run: async (args) => {
      if (args.action === "status") {
        const running = making.jobs.running(parts.agent);
        return Promise.resolve({
          text: running === undefined ? "No video job runs." : runningText(running, making.clock),
          isError: false,
        });
      }
      return Promise.resolve(make(parts, making, args));
    },
  });
}
