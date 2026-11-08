import type { Clock } from "@binference/core";
import {
  type GatewayVideoBody,
  gatewayVideoBodyOf,
  type VideoMakingRequest,
} from "./gateway-video-body.js";
import { type GatewayVideoJob, gatewayVideoJobOf } from "./gateway-video-job.schema.js";
import { type GatewayVideoModel, gatewayVideoModelOf } from "./gateway-video-models.schema.js";

/** The JSON the gateway answered, as the job and model readers take it. */
type Json = Parameters<typeof gatewayVideoJobOf>[0];

/** One answer of the gateway: its status and its JSON body. */
export interface GatewayAnswer {
  readonly status: number;
  readonly body: Json;
}

/** A downloaded file's bytes, or why none came, in a line the agent reads. */
export type Download =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly failure: string };

/** The gateway's video endpoint, as the provider's own client reaches it (decision 0405). */
export interface GatewayVideoClient {
  /** `GET /videos/models`: every video model and the values it takes. */
  models(signal: AbortSignal): Promise<Json>;
  /** `POST /videos` with an `Idempotency-Key`: starts the video. */
  create(body: GatewayVideoBody, key: string, signal: AbortSignal): Promise<GatewayAnswer>;
  /** `GET /videos/{id}`: the job as it is now. */
  read(id: string, signal: AbortSignal): Promise<GatewayAnswer>;
  /** Downloads the file of a finished job from one of its links. */
  download(url: string, signal: AbortSignal): Promise<Download>;
}

/** The video the model made and what it was charged, or why it made none. */
export type VideoMakingOutcome =
  | { readonly ok: true; readonly video: Uint8Array; readonly costMicros?: bigint }
  | { readonly ok: false; readonly failure: string };

/** The model that makes the agent's videos, by its `<provider>/<model>` name. */
export interface VideoMaker {
  readonly model: string;
  /** Makes one video; `key` keeps a second start of the same job from making another. */
  make(
    request: VideoMakingRequest,
    call: { readonly key: string; readonly signal: AbortSignal },
  ): Promise<VideoMakingOutcome>;
}

/** How often a job is read, and for how long, as the gateway asks. */
const videoPolling: { readonly everyMs: number; readonly forMs: number } = {
  everyMs: 10_000,
  forMs: 15 * 60_000,
};

// A read that may pass: the gateway is busy, rate-limited or down for a moment.
const passing = (status: number): boolean => status === 429 || status >= 500;

const said = (job: GatewayVideoJob, fallback: string): string => job.error ?? fallback;

// Reads the job every 10 seconds until it ends, or for at most 15 minutes.
async function finished(
  context: { readonly client: GatewayVideoClient; readonly clock: Clock },
  id: string,
  signal: AbortSignal,
): Promise<GatewayVideoJob | string> {
  const { client, clock } = context;
  const until = clock.now() + videoPolling.forMs;
  while (clock.now() < until) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each read waits its turn, as the gateway asks
    await clock.sleep(videoPolling.everyMs, signal);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one read at a time
    const answer = await client.read(id, signal).catch(() => undefined);
    const job = answer === undefined ? undefined : gatewayVideoJobOf(answer.body);
    if (answer !== undefined && job !== undefined && !passing(answer.status)) {
      if (answer.status >= 400) {
        return `the gateway refused to read the job: ${said(job, String(answer.status))}`;
      }
      if (job.status !== "pending" && job.status !== "in_progress") {
        return job;
      }
    }
  }
  return "the video was not ready after 15 minutes; the owner finds it on the gateway's Videos page";
}

// Downloads the finished job's file, from its first link or the gateway's content address.
async function fetched(
  client: GatewayVideoClient,
  job: GatewayVideoJob,
  signal: AbortSignal,
): Promise<VideoMakingOutcome> {
  if (job.status !== "completed") {
    const ended = job.status === "expired" ? "expired" : "failed";
    return { ok: false, failure: `the video ${ended}: ${said(job, "the gateway gave no reason")}` };
  }
  const url = job.urls[0] ?? (job.id === undefined ? undefined : `/videos/${job.id}/content`);
  if (url === undefined) {
    return { ok: false, failure: "the gateway gave no link to the finished video" };
  }
  const file = await client.download(url, signal);
  const cost = job.costMicros === undefined ? {} : { costMicros: job.costMicros };
  return file.ok ? { ok: true, video: file.bytes, ...cost } : file;
}

/** Why a request failed, in a line, from what was thrown. */
type FailureOf = (error: ErrorOptions["cause"], signal: AbortSignal) => string;

// Starts the job, waits for its end and downloads its file.
async function madeOn(
  context: { readonly client: GatewayVideoClient; readonly clock: Clock },
  body: GatewayVideoBody,
  call: { readonly key: string; readonly signal: AbortSignal },
): Promise<VideoMakingOutcome> {
  const { client } = context;
  const started = await client.create(body, call.key, call.signal);
  const job = gatewayVideoJobOf(started.body);
  if (started.status >= 400 || job.id === undefined) {
    return {
      ok: false,
      failure: `the gateway refused the video: ${said(job, String(started.status))}`,
    };
  }
  const ended = await finished(context, job.id, call.signal);
  return typeof ended === "string"
    ? { ok: false, failure: ended }
    : fetched(client, ended, call.signal);
}

/**
 * Makes videos through the bInference gateway's video endpoint (decision 0405): the model's entry
 * of `GET /videos/models`, read once, says which values it takes, and `POST /videos` gets only
 * those, under the job's `Idempotency-Key`. The job is read every 10 seconds for at most 15
 * minutes, then its file is downloaded. A model the list does not hold, a value it does not take,
 * a refused call and a failed or expired job are each said in a line; a failed list read is read
 * again next time.
 */
export function gatewayVideoMaker(
  names: { readonly name: string; readonly model: string },
  parts: { readonly client: GatewayVideoClient; readonly clock: Clock },
  failureOf: FailureOf,
): VideoMaker {
  const facts: { read: Promise<GatewayVideoModel | undefined> | undefined } = { read: undefined };
  const factsOf = async (signal: AbortSignal): Promise<GatewayVideoModel | undefined> => {
    // A failed read is not kept: the catch below clears it, so the next call reads again.
    facts.read ??= parts.client
      .models(signal)
      .then((list) => gatewayVideoModelOf(list, names.model));
    return facts.read;
  };
  return {
    model: names.name,
    make: async (request, call): Promise<VideoMakingOutcome> => {
      try {
        const model = await factsOf(call.signal);
        if (model === undefined) {
          return {
            ok: false,
            failure: `${names.name} is not one of the gateway's video models: the owner sets models.videoMaking to one of GET /videos/models, such as binference/alibaba/wan-3.0`,
          };
        }
        const body = gatewayVideoBodyOf({ name: names.model, facts: model }, request);
        return body.ok ? await madeOn(parts, body.body, call) : body;
      } catch (error) {
        facts.read = undefined;
        return { ok: false, failure: failureOf(error, call.signal) };
      }
    },
  };
}
