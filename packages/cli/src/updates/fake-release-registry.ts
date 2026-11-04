import {
  BinferenceError,
  err,
  type Http,
  type HttpDownload,
  type HttpRequest,
  type HttpResponse,
  type JsonValue,
  ok,
} from "@binference/core";
import type { ReleaseNotes } from "@binference/protocol";
import { z } from "zod";
import type { BundleVerifier } from "../plugins/npm-provenance.js";
import { packageUrlOf } from "../plugins/npm-provenance.js";
import { sha512Integrity } from "../skills/fetch-skill.js";

/** One request as binference made it, before any adapter: what a test reads it sends. */
interface MadeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** How a test publishes a release: its notes, and how its provenance reads. */
interface PublishedRelease {
  readonly notes?: ReleaseNotes;
  /**
   * `release` names binference's own release workflow run from the version's tag, `branch` that
   * workflow run from a branch, `workflow` another workflow of binference's repository, `other`
   * another repository's, `none` no provenance at all. `release` when left out.
   */
  readonly provenance?: "release" | "branch" | "workflow" | "other" | "none";
  /** Serves a tarball that is not the one the release's document names. */
  readonly isTampered?: boolean;
  /** The tarball's bytes, such as a packed release's; a few words of text when left out. */
  readonly bytes?: Uint8Array;
}

/** npm's registry and binference.io's counts as a test stands them up, in memory. */
export interface FakeReleaseRegistry {
  /** The registry's origin, which a test host names as `npmRegistry`. */
  readonly registry: string;
  /** Where the counts go, which a test host names as `countsUrl`. */
  readonly countsUrl: string;
  /** Answers each request as the registry and binference.io would. */
  readonly http: Http;
  /** Answers each download as the registry would: documents, tarballs and attestations. */
  readonly download: HttpDownload;
  /**
   * Checks the bundles this registry signs for a test, as Sigstore's verifier checks real ones:
   * the certificate names the workflow the release was published with.
   */
  readonly verifier: BundleVerifier;
  /** Points a dist-tag at a version. */
  tag(tag: string, version: string): void;
  /** Publishes a version's manifest, with notes for owners when given. */
  publish(version: string, notes?: ReleaseNotes): void;
  /** Publishes a version with a tarball and its provenance; answers the tarball's bytes. */
  release(version: string, published?: PublishedRelease): Uint8Array;
  /** Answers every request with this status from now on, such as 503. */
  answerAll(status: number): void;
  /** Every request made, in order. */
  requests(): readonly MadeRequest[];
  /** Resolves with the first request of the method made from now on. */
  next(method: string): Promise<MadeRequest>;
}

const registry = "https://registry.test";
const countsUrl = "https://counts.test/api/v1/counts";
const provenanceType = "https://slsa.dev/provenance/v1";
const ours = "https://github.com/bInference-Lab/bInference/.github/workflows";
const workflows = {
  release: (version: string) => `${ours}/release.yml@refs/tags/v${version}`,
  branch: () => `${ours}/release.yml@refs/heads/master`,
  workflow: (version: string) => `${ours}/ci.yml@refs/tags/v${version}`,
  other: () => "https://github.com/someone/fork/.github/workflows/release.yml@refs/heads/main",
} as const;

/** What the fake holds: its dist-tags, its documents, its files, and a status for everything. */
interface Held {
  readonly tags: Map<string, string>;
  readonly documents: Map<string, string>;
  readonly files: Map<string, Uint8Array>;
  status?: number;
}

function madeOf(request: HttpRequest): MadeRequest {
  const made = { method: request.method, url: request.url, headers: { ...request.headers } };
  return request.body === undefined ? made : { ...made, body: request.body };
}

function answerOf(status: number, body: string): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

// The registry's, or binference.io's, answer to one request.
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
  const document = held.documents.get(path);
  return document === undefined ? answerOf(404, "{}") : answerOf(200, document);
}

// The attestation of a version: a statement naming the package and its tarball, which the test
// signs by naming the workflow its certificate would carry.
function attestationOf(version: string, bytes: Uint8Array, workflow: string): string {
  const digest = Buffer.from(sha512Integrity(bytes).slice("sha512-".length), "base64");
  const subject = {
    name: packageUrlOf("binference", version),
    digest: { sha512: digest.toString("hex") },
  };
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: provenanceType,
    subject: [subject],
  };
  const payload = Buffer.from(JSON.stringify(statement)).toString("base64");
  const bundle = {
    dsseEnvelope: { payloadType: "application/vnd.in-toto+json", payload },
    testCertificate: { signedBy: workflow },
  };
  return JSON.stringify({ attestations: [{ predicateType: provenanceType, bundle }] });
}

function releaseOf(held: Held, version: string, published: PublishedRelease): Uint8Array {
  const bytes = published.bytes ?? new TextEncoder().encode(`the tarball of binference ${version}`);
  const tarball = `/binference/-/binference-${version}.tgz`;
  const provenance = published.provenance ?? "release";
  const claimed = { provenance: { predicateType: provenanceType } };
  const notes =
    published.notes === undefined ? {} : { binference: { releaseNotes: published.notes } };
  const dist = {
    integrity: sha512Integrity(bytes),
    tarball: `${registry}${tarball}`,
    ...(provenance === "none" ? {} : { attestations: claimed }),
  };
  const document = { name: "binference", version, dist, ...notes };
  held.documents.set(`/binference/${version}`, JSON.stringify(document));
  const served =
    published.isTampered === true ? new TextEncoder().encode("another tarball") : bytes;
  held.files.set(tarball, served);
  if (provenance !== "none") {
    const attested = attestationOf(version, bytes, workflows[provenance](version));
    held.documents.set(`/-/npm/v1/attestations/binference@${version}`, attested);
  }
  return bytes;
}

// The workflow a bundle this fake signed names; none for any other bundle.
const signedSchema = z.object({ testCertificate: z.object({ signedBy: z.string() }) });

function signedByOf(bundle: JsonValue): string | undefined {
  const signed = signedSchema.safeParse(bundle);
  return signed.success ? signed.data.testCertificate.signedBy : undefined;
}

// The test's verifier: a bundle this fake signed names its workflow; anything else is unverified.
const verifier: BundleVerifier = async (bundle) => {
  const signedBy = signedByOf(bundle);
  if (signedBy === undefined) {
    return Promise.resolve(err("unverified"));
  }
  const sourceRepository = signedBy.replace(/\/\.github\/workflows\/.*$/, "");
  const issuer = "https://token.actions.githubusercontent.com";
  return Promise.resolve(ok({ signedBy, issuer, sourceRepository }));
};

// Downloads as the registry answers them: a host but the registry's and binference.io's never
// answers, and an answer past the limit is refused, as the outbound adapter refuses it.
function downloadOf(held: Held, answer: (request: HttpRequest) => HttpResponse): HttpDownload {
  const served = new Set([new URL(registry).origin, new URL(countsUrl).origin]);
  return {
    download: async ({ url, signal, maxBytes }) => {
      signal.throwIfAborted();
      if (!served.has(new URL(url).origin)) {
        const unreachable = {
          code: "http.unreachable",
          message: "No answer.",
          retryable: true,
        } as const;
        return Promise.reject(new BinferenceError(unreachable));
      }
      const file = held.files.get(new URL(url).pathname);
      const { status, headers, body } = answer({ method: "GET", url, signal });
      const bytes = file ?? new TextEncoder().encode(body);
      if (bytes.byteLength > maxBytes) {
        const tooLarge = {
          code: "http.answer_too_large",
          message: "The answer is too large.",
        } as const;
        return Promise.reject(new BinferenceError(tooLarge));
      }
      return Promise.resolve({ status: file === undefined ? status : 200, headers, bytes });
    },
  };
}

/** A fresh {@link FakeReleaseRegistry} with no tag and no version. */
export function createFakeReleaseRegistry(): FakeReleaseRegistry {
  const held: Held = { tags: new Map(), documents: new Map(), files: new Map() };
  const made: MadeRequest[] = [];
  const waiting: { readonly method: string; readonly take: (request: MadeRequest) => void }[] = [];
  const answer = (request: HttpRequest): HttpResponse => {
    const taken = madeOf(request);
    made.push(taken);
    const due = waiting.filter((wait) => wait.method === request.method);
    due.forEach((wait) => {
      waiting.splice(waiting.indexOf(wait), 1);
      wait.take(taken);
    });
    return answerTo(held, request);
  };
  return {
    registry,
    countsUrl,
    http: { request: async (request) => Promise.resolve(answer(request)) },
    download: downloadOf(held, answer),
    verifier,
    tag: (tag, version) => held.tags.set(tag, version),
    publish: (version, notes) => {
      const extra = notes === undefined ? {} : { binference: { releaseNotes: notes } };
      const document = { name: "binference", version, ...extra };
      held.documents.set(`/binference/${version}`, JSON.stringify(document));
    },
    release: (version, published = {}) => releaseOf(held, version, published),
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
