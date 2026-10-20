import {
  err,
  type Http,
  type HttpResponse,
  ok,
  type PinStatus,
  type Result,
} from "@binference/plugin-sdk";
import type { z } from "zod";
import {
  type FlapPinState,
  pinAnswerSchema,
  readJsonAnswer,
  uploadAnswerSchema,
} from "./flap-answers.schema.js";
import { type FormPart, multipartBody } from "./multipart-body.js";

// Flap's own API for a launch's words and picture (developer docs, "Launch token through Portal"
// and "Pin Existing IPFS Content"). Nothing here reads an IPFS gateway: a read of a fresh CID
// through Flap's gateway before Flap holds it leaves that CID refused there for good.
const apiOrigin = "https://funcs.flap.sh";
const uploadUrl = `${apiOrigin}/api/upload`;
const pinsUrl = `${apiOrigin}/api/v1/ipfs/pins`;

// The upload carries a picture of up to 5 MiB, so it gets most of the host's 12 s; a status read
// is small and stays inside the host's 5 s call.
const uploadTimeoutMs = 10_000;
const statusTimeoutMs = 4_000;

const createMutation =
  "mutation Create($file: Upload!, $meta: MetadataInput!) { create(file: $file, meta: $meta) }";

/**
 * Why Flap's API refused or failed a call: `too_large` (413), `rate_limited` (429), `refused`
 * (another 4xx, or GraphQL errors), `unavailable` (5xx, or a page that is no API answer, as when
 * Flap has not deployed an endpoint), or `bad_answer` (a 2xx that is not the documented shape).
 */
export type FlapApiFailure =
  | "too_large"
  | "rate_limited"
  | "refused"
  | "unavailable"
  | "bad_answer";

/** The words a token's metadata holds, as Flap's `MetadataInput` takes them. */
export interface FlapMetadata {
  readonly description: string;
  readonly website: string | null;
  readonly twitter: string | null;
  readonly telegram: string | null;
  /** The wallet that launches the token. */
  readonly creator: string;
}

/** The picture of a launch: its bytes, its type and its file name. */
export interface FlapImage {
  readonly bytes: Readonly<Uint8Array>;
  readonly contentType: string;
  readonly fileName: string;
}

const pinStatuses: Readonly<Record<FlapPinState, PinStatus>> = {
  queued: "pending",
  retrieving: "pending",
  processing: "pending",
  not_found: "pending",
  pinned: "pinned",
  failed: "failed",
};

function failureOf(response: HttpResponse): FlapApiFailure | undefined {
  const { status } = response;
  const isJson = (response.headers["content-type"] ?? "").includes("json");
  if (status === 413) {
    return "too_large";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500 || !isJson) {
    return "unavailable";
  }
  return status >= 400 ? "refused" : undefined;
}

// An answer as the schema reads it; GraphQL errors in a 200 are a refusal.
function answerOf<T>(response: HttpResponse, schema: z.ZodType<T>): Result<T, FlapApiFailure> {
  const failure = failureOf(response);
  if (failure !== undefined) {
    return err(failure);
  }
  const read = readJsonAnswer(response.body, schema);
  if (read.kind === "errors") {
    return err("refused");
  }
  return read.kind === "answer" ? ok(read.value) : err("bad_answer");
}

const within = (signal: AbortSignal, ms: number): AbortSignal =>
  AbortSignal.any([signal, AbortSignal.timeout(ms)]);

/**
 * Uploads a token's picture and metadata to IPFS through Flap's upload API, which also pins them
 * on Flap's storage, as Flap's docs require of a launch. It answers the metadata's CID, which the
 * create call names. The same picture and words give the same CID, so a retry stores nothing twice.
 */
export async function uploadMetadata(
  http: Http,
  upload: { readonly image: FlapImage; readonly metadata: FlapMetadata },
  signal: AbortSignal,
): Promise<Result<string, FlapApiFailure>> {
  const operations = { query: createMutation, variables: { file: null, meta: upload.metadata } };
  const parts: readonly FormPart[] = [
    { name: "operations", text: JSON.stringify(operations) },
    { name: "map", text: JSON.stringify({ "0": ["variables.file"] }) },
    {
      name: "0",
      file: upload.image.bytes,
      fileName: upload.image.fileName,
      contentType: upload.image.contentType,
    },
  ];
  const body = multipartBody(parts);
  const response = await http.request({
    method: "POST",
    url: uploadUrl,
    headers: { "content-type": body.contentType, accept: "application/json" },
    bodyBytes: body.bytes,
    signal: within(signal, uploadTimeoutMs),
  });
  const answer = answerOf(response, uploadAnswerSchema);
  return answer.ok ? ok(answer.value.data.create) : answer;
}

/**
 * Where Flap's pin of a CID stands, from its pin status API: `pinned` once Flap holds it,
 * `failed` once it reports it never will, and `pending` while it is queued, being fetched or
 * processed, or not yet on record. A status for another CID is a `bad_answer`.
 */
export async function readPinStatus(
  http: Http,
  cid: string,
  signal: AbortSignal,
): Promise<Result<PinStatus, FlapApiFailure>> {
  const response = await http.request({
    method: "GET",
    url: `${pinsUrl}?cid=${encodeURIComponent(cid)}`,
    headers: { accept: "application/json" },
    signal: within(signal, statusTimeoutMs),
  });
  const answer = answerOf(response, pinAnswerSchema);
  if (!answer.ok) {
    return answer;
  }
  const { data } = answer.value;
  if (data.cid !== cid) {
    return err("bad_answer");
  }
  return ok(pinStatuses[data.status]);
}
