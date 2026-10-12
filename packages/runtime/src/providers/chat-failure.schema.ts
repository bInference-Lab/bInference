import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { z } from "zod";
import type { ModelFailure } from "../loop/model-event.js";
import {
  clientFailures,
  type FailureContext,
  failureOfFacts,
  type ProviderFailure,
  stoppedFailure,
} from "./provider-failure.js";

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

function failureOfApiError(error: unknown, context: FailureContext): ProviderFailure {
  const parsed = apiErrorSchema.safeParse(error);
  const facts = parsed.success ? parsed.data : {};
  const code = facts.error?.code;
  return failureOfFacts(
    {
      status: facts.status,
      code: code === null || code === undefined ? undefined : String(code),
      words: facts.error?.message ?? undefined,
      headers: facts.headers,
    },
    failureOfCode,
    context,
  );
}

/**
 * Classifies what a Chat Completions call threw into the runtime's failure classes: a stop
 * (`aborted`), no answer or no answer in time (`transient`), an error status or a mid-stream
 * error event by its status and documented code, a stream that could not be read (`transient`),
 * and anything the client refused before sending (`request`).
 */
export function chatFailureOf(error: unknown, context: FailureContext): ProviderFailure {
  if (context.signal.aborted || error instanceof APIUserAbortError) {
    return stoppedFailure;
  }
  if (error instanceof APIConnectionTimeoutError) {
    return clientFailures.timeout;
  }
  if (error instanceof APIConnectionError) {
    return clientFailures.unreachable;
  }
  if (error instanceof APIError) {
    return failureOfApiError(error, context);
  }
  return error instanceof SyntaxError ? clientFailures.unreadable : clientFailures.refused;
}
