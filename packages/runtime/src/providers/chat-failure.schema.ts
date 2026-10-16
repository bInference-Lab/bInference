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

// The documented error body's fields; some gateways give the code as a number, and OpenRouter
// adds metadata: a moderation flag's `reasons` and `flagged_input`, and the `limit_source` of a
// 402 that asks for a wait.
const errorBodySchema = z.looseObject({
  code: z.union([z.string(), z.number()]).nullish(),
  message: z.string().nullish(),
  metadata: z
    .looseObject({
      reasons: z.array(z.string()).nullish(),
      flagged_input: z.string().nullish(),
      limit_source: z.string().nullish(),
    })
    .nullish()
    .catch(undefined),
});

type ErrorBody = z.infer<typeof errorBodySchema>;

const contextCodes = new Set(["context_length_exceeded"]);
// OpenAI's codes for a 429 that waiting never ends, and gateways' codes for spent credit.
const billingCodes = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "insufficient_balance",
  "key_limit",
]);
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

// A gateway's moderation flag is the provider stopping for its safety rules; a 402 of the gateway's
// in-flight budget passes, after the wait it asks for.
function failureOfMetadata(body: ErrorBody | undefined): ModelFailure | undefined {
  const metadata = body?.metadata;
  if (metadata?.flagged_input != null || metadata?.reasons != null) {
    return "refused";
  }
  return metadata?.limit_source === "openrouter_in_flight_budget" ? "transient" : undefined;
}

/** What a Chat Completions error answer says: its status, documented code and words. */
export function chatFailureFacts(error: unknown): FailureFacts {
  const { status, headers, body } = apiErrorOf(error, errorBodySchema);
  const code = body?.code;
  return {
    status,
    headers,
    code: code === null || code === undefined ? undefined : String(code),
    words: body?.message ?? undefined,
    failure: failureOfMetadata(body),
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
    factsOf: chatFailureFacts,
    failureOfCode,
  });
}
