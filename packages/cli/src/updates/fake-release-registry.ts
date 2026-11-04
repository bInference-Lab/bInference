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

/** A fresh {@link FakeReleaseRegistry} with no tag and no version. */
export function createFakeReleaseRegistry(): FakeReleaseRegistry {
  const tags = new Map<string, string>();
  const manifests = new Map<string, string>();
  const made: MadeRequest[] = [];
  const held: { status?: number } = {};
  const answer = (request: HttpRequest): HttpResponse => {
    if (held.status !== undefined) {
      return answerOf(held.status, "{}");
    }
    if (request.url === countsUrl && request.method === "POST") {
      return answerOf(202, "{}");
    }
    const path = new URL(request.url).pathname;
    if (path === "/-/package/binference/dist-tags") {
      return answerOf(200, JSON.stringify(Object.fromEntries(tags)));
    }
    const manifest = manifests.get(path.replace(/^\/binference\//, ""));
    return manifest === undefined ? answerOf(404, "{}") : answerOf(200, manifest);
  };
  return {
    registry,
    countsUrl,
    http: {
      request: async (request) => {
        made.push(madeOf(request));
        return answer(request);
      },
    },
    tag: (tag, version) => tags.set(tag, version),
    publish: (version, notes) => {
      const extra = notes === undefined ? {} : { binference: { releaseNotes: notes } };
      manifests.set(version, JSON.stringify({ name: "binference", version, ...extra }));
    },
    answerAll: (status) => {
      held.status = status;
    },
    requests: () => made,
  };
}
