import type { JsonValue } from "@binference/core";
import type { ModelFailure } from "../loop/model-event.js";
import type { RecordedAnswer } from "./recorded-http.js";

// The failures OpenAI, Anthropic and OpenRouter document for their APIs, written by hand from
// their error pages: OpenAI's error codes guide (`{ "error": { message, type, param, code } }`),
// Anthropic's errors page (`{ "type": "error", "error": { type, message }, "request_id" }`) and
// OpenRouter's errors reference (`{ "error": { code, message, metadata } }`, a moderation flag's
// `reasons` and `flagged_input`, an error event in the middle of a stream). Each case says the
// class it gets and what the runner does next.

/** One documented failure, the class the transport gives it, and the runner's next step. */
export interface ProviderFailureCase {
  /** The transport that reads it: Chat Completions for OpenAI and OpenRouter. */
  readonly provider: "openai" | "anthropic" | "openrouter";
  readonly name: string;
  readonly answer: RecordedAnswer;
  readonly failure: ModelFailure;
  readonly retryAfterMs?: number;
  /** The same model again, the next model, or the end of the call. */
  readonly step: "retry" | "next" | "end";
}

const json = { "content-type": "application/json" };

/** An error answer in OpenAI's documented shape. */
export function openaiAnswer(
  status: number,
  error: { readonly message: string; readonly type: string; readonly code: string | null },
  headers: Readonly<Record<string, string>> = {},
): RecordedAnswer {
  const body = {
    error: { message: error.message, type: error.type, param: null, code: error.code },
  };
  return { status, headers: { ...json, ...headers }, chunks: [JSON.stringify(body)] };
}

/** An error answer in Anthropic's documented shape. */
export function anthropicAnswer(
  status: number,
  error: { readonly type: string; readonly message: string },
  headers: Readonly<Record<string, string>> = {},
): RecordedAnswer {
  const body = { type: "error", error, request_id: "req_011CSHoEeqs5C35K2UUqR7Fy" };
  return { status, headers: { ...json, ...headers }, chunks: [JSON.stringify(body)] };
}

/** An error answer in OpenRouter's documented shape. */
export function openrouterAnswer(
  status: number,
  error: { readonly message: string; readonly metadata?: Readonly<Record<string, JsonValue>> },
  headers: Readonly<Record<string, string>> = {},
): RecordedAnswer {
  const body = { error: { code: status, ...error } };
  return { status, headers: { ...json, ...headers }, chunks: [JSON.stringify(body)] };
}
