import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ModelFailure } from "../loop/model-event.js";
import {
  apiErrorOf,
  type FailureContext,
  type FailureFacts,
  type ProviderFailure,
  thrownFailure,
} from "./provider-failure.schema.js";

// Anthropic's error body, `{ "type": "error", "error": { "type", "message" }, "request_id" }`,
// for an error answer and for an `error` event in the middle of a stream alike.
const errorBodySchema = z.looseObject({
  error: z.looseObject({ type: z.string().nullish(), message: z.string().nullish() }).nullish(),
});

// Anthropic's documented error types. `invalid_request_error` is left to its status and words: a
// request over the context window is one too.
const failureOfType: ReadonlyMap<string, ModelFailure> = new Map([
  ["authentication_error", "auth"],
  ["permission_error", "auth"],
  ["billing_error", "billing"],
  ["not_found_error", "request"],
  ["request_too_large", "context"],
  ["rate_limit_error", "transient"],
  ["api_error", "transient"],
  ["timeout_error", "transient"],
  ["overloaded_error", "transient"],
]);

function factsOf(error: unknown): FailureFacts {
  const { status, headers, body } = apiErrorOf(error, errorBodySchema);
  return {
    status,
    headers,
    code: body?.error?.type ?? undefined,
    words: body?.error?.message ?? undefined,
  };
}

/**
 * Classifies what a Messages call threw into the runtime's failure classes (decision 0187): a
 * stop (`aborted`), no answer or no answer in time (`transient`), an error status or an `error`
 * event by Anthropic's documented error type, then its status, then the words of a request over
 * the context window; a stream that could not be read (`transient`); and anything the client
 * refused before sending (`request`).
 */
export function messagesFailureOf(error: unknown, context: FailureContext): ProviderFailure {
  return thrownFailure(error, context, {
    stop: APIUserAbortError,
    timeout: APIConnectionTimeoutError,
    unreachable: APIConnectionError,
    answer: APIError,
    factsOf,
    failureOfCode: (type) => failureOfType.get(type),
  });
}
