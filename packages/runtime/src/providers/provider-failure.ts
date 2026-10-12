import type { ModelFailure } from "../loop/model-event.js";

// What every transport's failures have in common: a status, a documented code, the provider's
// words and the answer's headers become one failure class and the wait the provider asked for.

/** A failed model call, classified (runtime spec, section 8.2). */
export interface ProviderFailure {
  readonly failure: ModelFailure;
  /** Names the status and the provider's code, never the provider's own words. */
  readonly message: string;
  /** How long the provider asked to wait before another try, for a `transient` failure. */
  readonly retryAfterMs?: number;
}

/** What classifying a failure needs besides the failure: the call's signal and the time. */
export interface FailureContext {
  readonly signal: AbortSignal;
  /** Epoch milliseconds, to read a `Retry-After` given as a date. */
  readonly nowMs: number;
}

/** What a provider's error answer, or an error event in its stream, says. */
export interface FailureFacts {
  /** The answer's status; none for an error event in the middle of a stream. */
  readonly status?: number | undefined;
  /** The provider's documented code or error type. */
  readonly code?: string | undefined;
  /** The provider's words, read only to tell a request over the context window. */
  readonly words?: string | undefined;
  readonly headers?: Headers | undefined;
}

// Compatible servers that give no code say a request is over the context window in words such
// as these (OpenAI-compatible servers, Anthropic's models through a gateway, llama.cpp);
// the words only pick the class and are never repeated.
const contextWords =
  /maximum context length|context (?:length|window|size)|prompt is too long|input is too long|too many (?:input )?tokens|input token count .* exceeds/i;

const transientStatuses = new Set([408, 409, 429]);

function failureOfStatus(status: number): ModelFailure {
  if (status === 413) {
    return "context";
  }
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 402) {
    return "billing";
  }
  return transientStatuses.has(status) || status >= 500 ? "transient" : "request";
}

// A refused request whose words say it is over the context window is a `context` failure.
function withContextWords(failure: ModelFailure, words: string | undefined): ModelFailure {
  return failure === "request" && contextWords.test(words ?? "") ? "context" : failure;
}

// A status a gateway puts in a mid-stream error's code.
function statusIn(code: string | undefined): number | undefined {
  return code !== undefined && /^[1-5]\d\d$/.test(code) ? Number(code) : undefined;
}

function retryAfterMsOf(headers: Headers | undefined, nowMs: number): number | undefined {
  const inMs = Number.parseFloat(headers?.get("retry-after-ms") ?? "");
  if (Number.isFinite(inMs) && inMs >= 0) {
    return Math.ceil(inMs);
  }
  const value = headers?.get("retry-after") ?? "";
  const inSeconds = Number.parseFloat(value);
  if (/^\s*\d+(?:\.\d+)?\s*$/.test(value) && Number.isFinite(inSeconds)) {
    return Math.ceil(inSeconds * 1_000);
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

function described(status: number | undefined, code: string | undefined): string {
  const named = code !== undefined && /^[\w.-]{1,64}$/.test(code) ? ` (${code})` : "";
  return status === undefined
    ? `The model provider ended the stream with an error${named}.`
    : `The model provider answered ${String(status)}${named}.`;
}

/**
 * Classifies a provider's error answer or mid-stream error event: by its documented code first
 * (`failureOfCode`), then by its status, a numeric code standing for a status. Statuses: 413
 * `context`; 401 and 403 `auth`; 402 `billing`; 408, 409, 429 and every 5xx `transient`; any other
 * `request`, unless its words say the request is over the context window. No status at all is
 * `transient`. A `transient` failure carries the wait from `retry-after-ms`, or `retry-after` in
 * seconds or as a date.
 */
export function failureOfFacts(
  facts: FailureFacts,
  failureOfCode: (code: string) => ModelFailure | undefined,
  context: FailureContext,
): ProviderFailure {
  const status = facts.status ?? statusIn(facts.code);
  const byStatus = status === undefined ? "transient" : failureOfStatus(status);
  const byCode = facts.code === undefined ? undefined : failureOfCode(facts.code);
  const failure = byCode ?? withContextWords(byStatus, facts.words);
  const retryAfterMs =
    failure === "transient" ? retryAfterMsOf(facts.headers, context.nowMs) : undefined;
  return {
    failure,
    message: described(facts.status, facts.code),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

/** A call the signal stopped. */
export const stoppedFailure: ProviderFailure = {
  failure: "aborted",
  message: "The model call was stopped.",
};

/** The failures every client throws alike: no answer in time, no answer, an unreadable stream. */
export const clientFailures: Readonly<
  Record<"timeout" | "unreachable" | "unreadable" | "refused", ProviderFailure>
> = {
  timeout: { failure: "transient", message: "The model provider did not answer in time." },
  unreachable: { failure: "transient", message: "No answer came from the model provider." },
  unreadable: {
    failure: "transient",
    message: "The model provider sent a stream it could not read.",
  },
  refused: {
    failure: "request",
    message: "The model client refused the request before sending it.",
  },
};
