import type { Http, HttpRequest, HttpResponse } from "@binference/core";
import type { ReleaseNotes } from "@binference/protocol";

/** One request as binference made it, before any adapter: what a test reads it sends. */
interface MadeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** npm's registry and binference.io's counts as a test stands them up, in memory. */
export interface FakeReleaseRegistry {
  /** The registry's origin, which a test host names as `npmRegistry`. */
  readonly registry: string;
  /** Where the counts go, which a test host names as `countsUrl`. */
  readonly countsUrl: string;
  /** Answers each request as the registry and binference.io would. */
  readonly http: Http;
  /** Points a dist-tag at a version. */
  tag(tag: string, version: string): void;
  /** Publishes a version's manifest, with notes for owners when given. */
  publish(version: string, notes?: ReleaseNotes): void;
  /** Answers every request with this status from now on, such as 503. */
  answerAll(status: number): void;
  /** Every request made, in order. */
  requests(): readonly MadeRequest[];
  /** Resolves with the first request of the method made from now on. */
  next(method: string): Promise<MadeRequest>;
}

const registry = "https://registry.test";
const countsUrl = "https://counts.test/api/v1/counts";

function madeOf(request: HttpRequest): MadeRequest {
  const made = { method: request.method, url: request.url, headers: { ...request.headers } };
  return request.body === undefined ? made : { ...made, body: request.body };
}

function answerOf(status: number, body: string): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

/** What the fake holds: its dist-tags, its manifests and a status that answers everything. */
interface Held {
  readonly tags: Map<string, string>;
  readonly manifests: Map<string, string>;
  status?: number;
}

// The answer of the registry, or of binference.io for the counts, to one request.
function answerTo(held: Held, request: HttpRequest): HttpResponse {
  if (held.status !== undefined) {
    return answerOf(held.status, "{}");
  }
  if (request.url === countsUrl && request.method === "POST") {
    return answerOf(202, "{}");
  }
  const path = new URL(request.url).pathname;
  if (path === "/-/package/binference/dist-tags") {
    return answerOf(200, JSON.stringify(Object.fromEntries(held.tags)));
  }
  const manifest = held.manifests.get(path.replace(/^\/binference\//, ""));
  return manifest === undefined ? answerOf(404, "{}") : answerOf(200, manifest);
}

/** A fresh {@link FakeReleaseRegistry} with no tag and no version. */
export function createFakeReleaseRegistry(): FakeReleaseRegistry {
  const held: Held = { tags: new Map(), manifests: new Map() };
  const made: MadeRequest[] = [];
  const waiting: { readonly method: string; readonly take: (request: MadeRequest) => void }[] = [];
  return {
    registry,
    countsUrl,
    http: {
      request: async (request) => {
        const taken = madeOf(request);
        made.push(taken);
        const answered = answerTo(held, request);
        const due = waiting.filter((wait) => wait.method === request.method);
        due.forEach((wait) => {
          waiting.splice(waiting.indexOf(wait), 1);
          wait.take(taken);
        });
        return answered;
      },
    },
    tag: (tag, version) => held.tags.set(tag, version),
    publish: (version, notes) => {
      const extra = notes === undefined ? {} : { binference: { releaseNotes: notes } };
      held.manifests.set(version, JSON.stringify({ name: "binference", version, ...extra }));
    },
    answerAll: (status) => {
      held.status = status;
    },
    requests: () => made,
    next: async (method) =>
      new Promise((resolve) => {
        waiting.push({ method, take: resolve });
      }),
  };
}
