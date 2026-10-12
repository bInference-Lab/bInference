import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { z } from "zod";
import type { ModelFailure } from "../loop/model-event.js";

/** A failed model call, classified (runtime spec, section 8.2). */
export interface ChatFailure {
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

// The documented error body's fields; some gateways give the code as a number.
const errorBodySchema = z.looseObject({
  code: z.union([z.string(), z.number()]).nullish(),
  message: z.string().nullish(),
});

// What the client's error carries: its status (none for an error event mid-stream), the answer's
// headers and the error body.
const apiErrorSchema = z.object({
  status: z.int().optional(),
  headers: z.instanceof(Headers).optional(),
  error: errorBodySchema.optional().catch(undefined),
});

type ApiErrorFacts = z.infer<typeof apiErrorSchema>;

const contextCodes = new Set(["context_length_exceeded"]);
const billingCodes = new Set(["insufficient_quota", "insufficient_balance", "key_limit"]);
const refusedCodes = new Set(["content_filter", "content_policy_violation"]);

// Compatible servers that give no code say a request is over the context window in words such
// as these (OpenAI-compatible servers, Anthropic's models through a gateway, llama.cpp); the
// words only pick the class and are never repeated.
const contextWords =
  /maximum context length|context (?:length|window|size)|prompt is too long|input is too long|too many (?:input )?tokens|input token count .* exceeds/i;

const transientStatuses = new Set([408, 409, 429]);

function codeOf(body: ApiErrorFacts["error"]): string | undefined {
  const code = body?.code;
  return code === null || code === undefined ? undefined : String(code);
}

function failureOfCode(code: string | undefined): ModelFailure | undefined {
  if (code === undefined) {
    return undefined;
  }
  if (contextCodes.has(code)) {
    return "context";
  }
  if (billingCodes.has(code)) {
    return "billing";
  }
  return refusedCodes.has(code) ? "refused" : undefined;
}

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

function failureOfApiError(error: ApiErrorFacts, context: FailureContext): ChatFailure {
  const body = error.error;
  const code = codeOf(body);
  const status = error.status ?? statusIn(code);
  const byStatus = status === undefined ? "transient" : failureOfStatus(status);
  const failure = failureOfCode(code) ?? withContextWords(byStatus, body?.message ?? undefined);
  const retryAfterMs =
    failure === "transient" ? retryAfterMsOf(error.headers, context.nowMs) : undefined;
  return {
    failure,
    message: described(error.status, code),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

/**
 * Classifies what a Chat Completions call threw into the runtime's failure classes: a stop
 * (`aborted`), no answer or no answer in time (`transient`), an error status or a mid-stream
 * error event by its status and documented code, a stream that could not be read (`transient`),
 * and anything the client refused before sending (`request`).
 */
export function chatFailureOf(error: unknown, context: FailureContext): ChatFailure {
  if (context.signal.aborted || error instanceof APIUserAbortError) {
    return { failure: "aborted", message: "The model call was stopped." };
  }
  if (error instanceof APIConnectionTimeoutError) {
    return { failure: "transient", message: "The model provider did not answer in time." };
  }
  if (error instanceof APIConnectionError) {
    return { failure: "transient", message: "No answer came from the model provider." };
  }
  if (error instanceof APIError) {
    const parsed = apiErrorSchema.safeParse(error);
    return failureOfApiError(parsed.success ? parsed.data : {}, context);
  }
  if (error instanceof SyntaxError) {
    return { failure: "transient", message: "The model provider sent a stream it could not read." };
  }
  return { failure: "request", message: "The model client refused the request before sending it." };
}
