import type { Clock, HttpRequest } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { VideoMakingRequest } from "./gateway-video-body.js";
import type { VideoMaker } from "./gateway-video-making.js";
import type { StreamingHttp } from "./ports.js";
import { videoMakerFor } from "./video-making.js";

const base = "https://gateway.example.test/api/v1";
const providers = {
  binference: { kind: "binference", baseUrl: base, apiKey: "bk-test" },
  openai: { kind: "openai", apiKey: "sk-test" },
} as const;
const mp4 = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const asked: VideoMakingRequest = { prompt: "A paper boat on a pond.", references: [] };
const call = { key: "f60718293a4b5c6d", signal: new AbortController().signal };

const wan = {
  id: "alibaba/wan-3.0",
  supported_resolutions: ["1080p", "480p", "720p"],
  supported_aspect_ratios: ["4:3", "16:9", "9:16"],
  supported_durations: [4, 6, 8],
  supported_frame_images: ["first_frame"],
  max_input_references: 1,
  generate_audio: true,
  seed: false,
};

/** One answer of the fake gateway: its status, headers, and JSON or bytes. */
interface Answer {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly json?: object;
  readonly bytes?: Uint8Array;
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array, void, undefined> {
  yield await Promise.resolve(bytes);
}

// A gateway whose answers come from `route`, by method and URL, and that keeps each request.
function gatewayOf(route: (request: HttpRequest) => Answer | Error) {
  const requests: HttpRequest[] = [];
  const http: StreamingHttp = {
    open: async (request) => {
      requests.push(request);
      const answer = route(request);
      if (answer instanceof Error) {
        return Promise.reject(answer);
      }
      const bytes = answer.bytes ?? new TextEncoder().encode(JSON.stringify(answer.json ?? {}));
      return { status: answer.status ?? 200, headers: answer.headers ?? {}, body: once(bytes) };
    },
  };
  // Each sleep moves the clock on, so a test reads every poll at once.
  const time = { now: 1_760_000_000_000 };
  const clock: Clock = {
    now: () => time.now,
    sleep: async (delayMs) => {
      time.now += delayMs;
      return Promise.resolve();
    },
  };
  return { requests, parts: { http, clock } };
}

const job = (status: string, more: object = {}) => ({ id: "vid_abc", status, ...more });

/** How the fake gateway answers one video's calls; each left out answers as a video that works. */
interface Script {
  readonly models?: object;
  readonly start?: Answer;
  /** The job's reads in order; once used up, it is still in progress. */
  readonly reads?: readonly (Answer | Error)[];
  readonly content?: Answer;
}

const routes: readonly (readonly [(request: HttpRequest) => boolean, keyof Script])[] = [
  [(request) => request.url.endsWith("/videos/models"), "models"],
  [(request) => request.method === "POST", "start"],
  [(request) => request.url.endsWith("/videos/vid_abc"), "reads"],
  [(request) => request.url.endsWith("/content"), "content"],
];

const fallback = {
  models: { json: { data: [wan] } },
  start: { json: job("pending") },
  reads: { json: job("in_progress") },
  content: { status: 302, headers: { location: "https://files.example.test/v.mp4" } },
} as const;

// A gateway that runs one video from start to download as `script` says, the file last.
function videoGateway(script: Script) {
  const reads = [...(script.reads ?? [])];
  const answerOf = (part: keyof Script): Answer | Error => {
    if (part === "reads") {
      return reads.shift() ?? fallback.reads;
    }
    if (part === "models") {
      return script.models === undefined ? fallback.models : { json: script.models };
    }
    return script[part] ?? fallback[part];
  };
  return gatewayOf((request) => {
    const route = routes.find(([matches]) => matches(request));
    return route === undefined ? { bytes: mp4 } : answerOf(route[1]);
  });
}

function makerOn(parts: ReturnType<typeof gatewayOf>["parts"]): VideoMaker {
  const maker = videoMakerFor({ providers, videoMaking: "binference/alibaba/wan-3.0" }, parts);
  if (typeof maker === "string") {
    throw new TypeError(maker);
  }
  return maker;
}

const done = {
  json: job("completed", {
    unsigned_urls: [`${base}/videos/vid_abc/content`],
    usage: { cost: 0.6 },
  }),
};

// The body of the first POST the gateway took.
function startBody(requests: readonly HttpRequest[]): unknown {
  return JSON.parse(String(requests.find((request) => request.method === "POST")?.body));
}

describe("videos made on the bInference gateway", () => {
  it("sends only listed values at their least, reads the job until it is done, and downloads it", async () => {
    const gateway = videoGateway({ reads: [{ json: job("in_progress") }, done] });
    const made = await makerOn(gateway.parts).make(asked, call);
    expect(made).toStrictEqual({ ok: true, video: mp4, costMicros: 600_000n });
    expect(startBody(gateway.requests)).toStrictEqual({
      model: "alibaba/wan-3.0",
      prompt: "A paper boat on a pond.",
      duration: 4,
      resolution: "480p",
      aspect_ratio: "16:9",
    });
    expect(gateway.requests.find((request) => request.method === "POST")?.headers).toMatchObject({
      authorization: "Bearer bk-test",
      "idempotency-key": "f60718293a4b5c6d",
    });
    const file = gateway.requests.at(-1);
    expect(file?.url).toBe("https://files.example.test/v.mp4");
    expect(file?.headers).toBeUndefined();
    expect(file?.publicOnly).toBe(true);
  });

  it("goes on reading past a busy gateway and a read that never answered", async () => {
    const reads = [{ status: 503, json: {} }, new Error("socket hang up"), done];
    const made = await makerOn(videoGateway({ reads }).parts).make(asked, call);
    expect(made).toMatchObject({ ok: true });
  });

  it("says why a job failed or expired, in the gateway's words", async () => {
    const refused = { json: job("failed", { error: { code: "content_refused", message: "No." } }) };
    const failed = await makerOn(videoGateway({ reads: [refused] }).parts).make(asked, call);
    expect(failed).toStrictEqual({ ok: false, failure: "the video failed: content_refused: No." });
    const expired = videoGateway({ reads: [{ json: job("expired") }] });
    expect(await makerOn(expired.parts).make(asked, call)).toStrictEqual({
      ok: false,
      failure: "the video expired: the gateway gave no reason",
    });
  });

  it("stops after 15 minutes of a job that never ends, and names where the owner finds it", async () => {
    const made = await makerOn(videoGateway({}).parts).make(asked, call);
    expect(made).toMatchObject({ ok: false });
    expect(JSON.stringify(made)).toContain("not ready after 15 minutes");
  });

  it("names a value the model does not take and sends nothing", async () => {
    const gateway = videoGateway({ reads: [done] });
    const made = await makerOn(gateway.parts).make({ ...asked, seconds: 5 }, call);
    expect(made).toStrictEqual({
      ok: false,
      failure: "the model makes videos of 4, 6, 8 seconds; ask for one of them",
    });
    expect(gateway.requests.filter((request) => request.method === "POST")).toStrictEqual([]);
  });

  it("says what the gateway refused a start for, and a read it refused", async () => {
    const start = { status: 402, json: { error: { code: "no_credit", message: "Top up." } } };
    expect(await makerOn(videoGateway({ start }).parts).make(asked, call)).toStrictEqual({
      ok: false,
      failure: "the gateway refused the video: no_credit: Top up.",
    });
    const gone = videoGateway({ reads: [{ status: 404, json: { error: { code: "not_found" } } }] });
    expect(await makerOn(gone.parts).make(asked, call)).toStrictEqual({
      ok: false,
      failure: "the gateway refused to read the job: not_found",
    });
  });

  it("refuses a download link off the gateway, a job with no link and a download that fails", async () => {
    const elsewhere = job("completed", { unsigned_urls: ["https://evil.example.test/v.mp4"] });
    const off = videoGateway({ reads: [{ json: elsewhere }] });
    expect(await makerOn(off.parts).make(asked, call)).toStrictEqual({
      ok: false,
      failure: "the gateway's link to the video is not under its address",
    });
    const lost = videoGateway({ reads: [{ json: { status: "completed" } }] });
    expect(await makerOn(lost.parts).make(asked, call)).toStrictEqual({
      ok: false,
      failure: "the gateway gave no link to the finished video",
    });
    const broken = videoGateway({ reads: [{ json: job("completed") }], content: { status: 404 } });
    expect(await makerOn(broken.parts).make(asked, call)).toStrictEqual({
      ok: false,
      failure: "the video's download answered 404",
    });
  });

  it("names a model the gateway does not list, and reads the list again after it fails", async () => {
    const unlisted = videoGateway({ models: { data: [] } });
    const named = await makerOn(unlisted.parts).make(asked, call);
    expect(named).toMatchObject({ ok: false });
    expect(JSON.stringify(named)).toContain("is not one of the gateway's video models");
    const down = gatewayOf(() => new Error("connect ECONNREFUSED"));
    const maker = makerOn(down.parts);
    expect(await maker.make(asked, call)).toStrictEqual({
      ok: false,
      failure: "the gateway did not answer: connect ECONNREFUSED",
    });
    await maker.make(asked, call);
    expect(down.requests.map((request) => request.url)).toStrictEqual([
      `${base}/videos/models`,
      `${base}/videos/models`,
    ]);
  });

  it("says which setting is missing or names a provider that is not the gateway", () => {
    const { parts } = videoGateway({});
    expect(videoMakerFor({ providers }, parts)).toContain("models.videoMaking");
    expect(videoMakerFor({ providers, videoMaking: "openai/sora-2" }, parts)).toContain(
      "is not the bInference gateway",
    );
  });
});
