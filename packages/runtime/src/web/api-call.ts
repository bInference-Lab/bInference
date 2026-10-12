import {
  BinferenceError,
  type Clock,
  createDeadline,
  type HttpRequest,
  type JsonValue,
  jsonValueSchema,
} from "@binference/core";
import type { StreamingHttp } from "../providers/ports.js";
import { discardBody, readBodyStart } from "./read-body.js";

/** How a search tool reaches its provider's API: the runtime's outbound HTTP and the clock. */
export interface ApiParts {
  readonly http: StreamingHttp;
  readonly clock: Clock;
}

/** How long one call to a search API may take. */
export const apiTimeoutMs = 20_000;

// The most of an API's answer that is read; a larger answer is refused.
const maxApiAnswerBytes = 1024 * 1024;

/** A provider's answer: its status and headers, and its JSON when the status is 2xx. */
export interface ApiAnswer {
  readonly kind: "answer";
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed body of a 2xx answer; `undefined` for any other status. */
  readonly json: JsonValue | undefined;
}

/** A call that got no answer the tool can read. */
export interface ApiFailure {
  readonly kind: "failed";
  readonly failure: "timeout" | "unreachable" | "too_large" | "not_json";
}

function parsedJson(bytes: Uint8Array): JsonValue | undefined {
  try {
    return jsonValueSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return undefined;
  }
}

async function answerOf(
  answer: Awaited<ReturnType<StreamingHttp["open"]>>,
): Promise<ApiAnswer | ApiFailure> {
  const { status, headers, body } = answer;
  if (status < 200 || status >= 300) {
    await discardBody(body);
    return { kind: "answer", status, headers, json: undefined };
  }
  const start = await readBodyStart(body, maxApiAnswerBytes);
  if (start.cut) {
    return { kind: "failed", failure: "too_large" };
  }
  const json = parsedJson(start.bytes);
  return json === undefined
    ? { kind: "failed", failure: "not_json" }
    : { kind: "answer", status, headers, json };
}

/**
 * Calls a search provider's API within 20 seconds and reads at most 1 MiB of its answer, as JSON
 * when its status is 2xx. A timeout, no answer, a larger answer or one that is not JSON is a
 * failure the tool reports; it rejects only when `signal` aborts, with its reason, or on a fault
 * that is not the network's.
 */
export async function callApi(
  request: Omit<HttpRequest, "signal">,
  parts: ApiParts,
  signal: AbortSignal,
): Promise<ApiAnswer | ApiFailure> {
  const deadline = createDeadline({ clock: parts.clock, signal, timeoutMs: apiTimeoutMs });
  try {
    return await answerOf(await parts.http.open({ ...request, signal: deadline.signal }));
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    if (deadline.signal.aborted) {
      return { kind: "failed", failure: "timeout" };
    }
    if (error instanceof BinferenceError && error.code === "http.unreachable") {
      return { kind: "failed", failure: "unreachable" };
    }
    throw error;
  } finally {
    deadline.clear();
  }
}
