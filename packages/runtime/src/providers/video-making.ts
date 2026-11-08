import type { Clock } from "@binference/core";
import { maxVideoBytes } from "@binference/protocol";
import type { RuntimeModels } from "../control/runtime-settings.schema.js";
import { discardBody, readBodyStart } from "../web/read-body.js";
import type { GatewayVideoBody } from "./gateway-video-body.js";
import { jsonOfText } from "./gateway-video-job.schema.js";
import {
  type Download,
  type GatewayAnswer,
  type GatewayVideoClient,
  gatewayVideoMaker,
  type VideoMaker,
} from "./gateway-video-making.js";
import { baseUrlOf } from "./model-transport-for.js";
import type { StreamingHttp } from "./ports.js";

/** What a video model's client reaches the network and the time through. */
export interface VideoMakingParts {
  readonly http: StreamingHttp;
  readonly clock: Clock;
}

// The most bytes of a JSON answer the client reads: a job or the model list.
const maxAnswerBytes = 1024 * 1024;
// How long one request may take; a download of up to 100 MiB gets longer.
const requestMs = 60_000;
const downloadMs = 5 * 60_000;
const redirects: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Where the gateway is and the key it takes. */
interface Endpoint {
  readonly http: StreamingHttp;
  /** The base URL with one trailing slash, which every request to the gateway starts with. */
  readonly prefix: string;
  readonly apiKey?: string;
}

function headersOf(endpoint: Endpoint, more: Readonly<Record<string, string>> = {}) {
  const key = endpoint.apiKey === undefined ? {} : { authorization: `Bearer ${endpoint.apiKey}` };
  return { accept: "application/json", ...key, ...more };
}

// The answer's JSON, or null when it holds none; an answer over 1 MiB reads as none.
async function jsonOf(body: AsyncIterable<Uint8Array>): Promise<GatewayAnswer["body"]> {
  const read = await readBodyStart(body, maxAnswerBytes);
  return read.cut ? null : jsonOfText(new TextDecoder().decode(read.bytes));
}

async function call(
  endpoint: Endpoint,
  request: { readonly path: string; readonly body?: string; readonly key?: string },
  signal: AbortSignal,
): Promise<GatewayAnswer> {
  const url = `${endpoint.prefix}${request.path}`;
  const timed = AbortSignal.any([signal, AbortSignal.timeout(requestMs)]);
  const answer =
    request.body === undefined
      ? await endpoint.http.open({
          method: "GET",
          url,
          headers: headersOf(endpoint),
          signal: timed,
        })
      : await endpoint.http.open({
          method: "POST",
          url,
          headers: headersOf(endpoint, {
            "content-type": "application/json",
            ...(request.key === undefined ? {} : { "idempotency-key": request.key }),
          }),
          body: request.body,
          signal: timed,
        });
  return { status: answer.status, body: await jsonOf(answer.body) };
}

// The file at a link of the job: the gateway's own address with the key, then the address it
// redirects to without it, which must be `https`.
async function download(endpoint: Endpoint, link: string, signal: AbortSignal): Promise<Download> {
  const url = link.startsWith("/") ? `${endpoint.prefix}${link.slice(1)}` : link;
  if (!url.startsWith(endpoint.prefix)) {
    return { ok: false, failure: "the gateway's link to the video is not under its address" };
  }
  const timed = AbortSignal.any([signal, AbortSignal.timeout(downloadMs)]);
  const first = await endpoint.http.open({
    method: "GET",
    url,
    headers: headersOf(endpoint, { accept: "*/*" }),
    signal: timed,
  });
  const location = first.headers["location"];
  const answer =
    redirects.has(first.status) && location !== undefined && location.startsWith("https://")
      ? await endpoint.http.open({ method: "GET", url: location, signal: timed, publicOnly: true })
      : first;
  if (answer !== first) {
    await discardBody(first.body);
  }
  if (answer.status !== 200) {
    await discardBody(answer.body);
    return { ok: false, failure: `the video's download answered ${String(answer.status)}` };
  }
  const read = await readBodyStart(answer.body, maxVideoBytes);
  return read.cut
    ? {
        ok: false,
        failure:
          "the video is over 100 MiB, which binference does not keep; ask for a shorter or smaller one",
      }
    : { ok: true, bytes: read.bytes };
}

/** The gateway's video endpoint over binference's outbound HTTP. */
function videoClientOf(endpoint: Endpoint): GatewayVideoClient {
  return {
    models: async (signal) => (await call(endpoint, { path: "videos/models" }, signal)).body,
    create: async (body: GatewayVideoBody, key, signal) =>
      call(endpoint, { path: "videos", body: JSON.stringify(body), key }, signal),
    read: async (id, signal) =>
      call(endpoint, { path: `videos/${encodeURIComponent(id)}` }, signal),
    download: async (link, signal) => download(endpoint, link, signal),
  };
}

// Why a request failed, in a line: the network's words cut short, or that it was stopped.
function failureOf(error: ErrorOptions["cause"], signal: AbortSignal): string {
  if (signal.aborted) {
    return "it took longer than binference waits for a video";
  }
  const words = error instanceof Error ? error.message.replaceAll(/\s+/gu, " ").trim() : "";
  return words === ""
    ? "the gateway did not answer"
    : `the gateway did not answer: ${words.slice(0, 300)}`;
}

/**
 * The model that makes the agent's videos under the settings in force (decision 0405):
 * `models.videoMaking` on the bInference gateway, through its own video endpoint over
 * binference's outbound HTTP. Answers why there is none, in a line the agent reads, when the
 * setting is missing or names a provider that is not the gateway.
 */
export function videoMakerFor(
  models: Pick<RuntimeModels, "providers" | "videoMaking">,
  parts: VideoMakingParts,
): VideoMaker | string {
  const name = models.videoMaking;
  const slash = name?.indexOf("/") ?? -1;
  if (name === undefined || slash <= 0 || slash === name.length - 1) {
    return "No model makes videos: the owner sets one in models.videoMaking as <provider>/<model>, on the bInference gateway. Tell the owner.";
  }
  const provider = models.providers[name.slice(0, slash)];
  if (provider?.kind !== "binference") {
    return "The provider of models.videoMaking is not the bInference gateway in models.providers, which alone makes videos. Tell the owner.";
  }
  const base = baseUrlOf(provider);
  const endpoint = {
    http: parts.http,
    prefix: base.endsWith("/") ? base : `${base}/`,
    ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
  };
  const client = videoClientOf(endpoint);
  return gatewayVideoMaker(
    { name, model: name.slice(slash + 1) },
    { client, clock: parts.clock },
    failureOf,
  );
}
