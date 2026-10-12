import { z } from "zod";
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

/** What an SDK's error answer carries: its status, the answer's headers and its body. */
interface ApiErrorParts<T> {
  /** None for an error event in the middle of a stream. */
  readonly status?: number | undefined;
  readonly headers?: Headers | undefined;
  /** The body, when it has the provider's documented shape. */
  readonly body?: T | undefined;
}

const apiErrorSchema = z.object({
  status: z.int().optional(),
  headers: z.instanceof(Headers).optional(),
  error: z.unknown().optional(),
});

/** Reads an SDK's error answer, its body by the provider's documented error shape. */
export function apiErrorOf<T>(error: unknown, bodySchema: z.ZodType<T>): ApiErrorParts<T> {
  const parsed = apiErrorSchema.safeParse(error);
  if (!parsed.success) {
    return {};
  }
  const body = bodySchema.safeParse(parsed.data.error);
  return {
    status: parsed.data.status,
    headers: parsed.data.headers,
    body: body.success ? body.data : undefined,
  };
}

// Compatible servers that give no code say a request is over the context window in words such
// as these (OpenAI-compatible servers, Anthropic's API and its models through a gateway, llama.cpp);
// the words only pick the class and are never repeated.
const contextWords =
  /maximum context length|context (?:length|window|size|limit)|prompt is too long|input is too long|too many (?:input )?tokens|input token count .* exceeds/i;

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
function failureOfFacts(
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

const stoppedFailure: ProviderFailure = {
  failure: "aborted",
  message: "The model call was stopped.",
};
const timeoutFailure: ProviderFailure = {
  failure: "transient",
  message: "The model provider did not answer in time.",
};
const unreachableFailure: ProviderFailure = {
  failure: "transient",
  message: "No answer came from the model provider.",
};
const unreadableFailure: ProviderFailure = {
  failure: "transient",
  message: "The model provider sent a stream it could not read.",
};
const refusedFailure: ProviderFailure = {
  failure: "request",
  message: "The model client refused the request before sending it.",
};

/** An error class a model SDK throws. */
type ErrorClass = abstract new (...args: never[]) => object;

/** What one model SDK throws, and how to read its error answers. */
export interface ClientErrors {
  /** The call was stopped. */
  readonly stop: ErrorClass;
  /** No answer came in time; a kind of `unreachable` in every SDK, so it is checked first. */
  readonly timeout: ErrorClass;
  /** No answer came. */
  readonly unreachable: ErrorClass;
  /** An error answer, or an error event in the middle of a stream. */
  readonly answer: ErrorClass;
  /** What an error answer says. */
  readonly factsOf: (error: unknown) => FailureFacts;
  /** The class of a provider's documented code, when the code decides it. */
  readonly failureOfCode: (code: string) => ModelFailure | undefined;
}

/**
 * Classifies what a model call threw into the runtime's failure classes: a stop (`aborted`), no
 * answer or no answer in time (`transient`), an error answer or a mid-stream error event by
 * {@link failureOfFacts}, a stream that could not be read (`transient`), and anything the client
 * refused before sending (`request`).
 */
export function thrownFailure(
  error: unknown,
  context: FailureContext,
  client: ClientErrors,
): ProviderFailure {
  if (context.signal.aborted || error instanceof client.stop) {
    return stoppedFailure;
  }
  if (error instanceof client.timeout) {
    return timeoutFailure;
  }
  if (error instanceof client.unreachable) {
    return unreachableFailure;
  }
  if (error instanceof client.answer) {
    return failureOfFacts(client.factsOf(error), client.failureOfCode, context);
  }
  return error instanceof SyntaxError ? unreadableFailure : refusedFailure;
}
