import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { z } from "zod";
import type { ModelFailure } from "../loop/model-event.js";
import {
  apiErrorOf,
  type FailureContext,
  type FailureFacts,
  type ProviderFailure,
  thrownFailure,
} from "./provider-failure.schema.js";

// The documented error body's fields; some gateways give the code as a number.
const errorBodySchema = z.looseObject({
  code: z.union([z.string(), z.number()]).nullish(),
  message: z.string().nullish(),
});

const contextCodes = new Set(["context_length_exceeded"]);
const billingCodes = new Set(["insufficient_quota", "insufficient_balance", "key_limit"]);
const refusedCodes = new Set(["content_filter", "content_policy_violation"]);

function failureOfCode(code: string): ModelFailure | undefined {
  if (contextCodes.has(code)) {
    return "context";
  }
  if (billingCodes.has(code)) {
    return "billing";
  }
  return refusedCodes.has(code) ? "refused" : undefined;
}

function factsOf(error: unknown): FailureFacts {
  const { status, headers, body } = apiErrorOf(error, errorBodySchema);
  const code = body?.code;
  return {
    status,
    headers,
    code: code === null || code === undefined ? undefined : String(code),
    words: body?.message ?? undefined,
  };
}

/**
 * Classifies what a Chat Completions call threw into the runtime's failure classes (decision
 * 0175): a stop (`aborted`), no answer or no answer in time (`transient`), an error status or a
 * mid-stream error event by its documented code, then its status, a stream that could not be read
 * (`transient`), and anything the client refused before sending (`request`).
 */
export function chatFailureOf(error: unknown, context: FailureContext): ProviderFailure {
  return thrownFailure(error, context, {
    stop: APIUserAbortError,
    timeout: APIConnectionTimeoutError,
    unreachable: APIConnectionError,
    answer: APIError,
    factsOf,
    failureOfCode,
  });
}
