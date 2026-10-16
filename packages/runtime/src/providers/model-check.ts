import { type Clock, err, type Http, ok, type Result, type Secret } from "@binference/core";
import { z } from "zod";
import type { RuntimeProvider } from "../control/runtime-settings.schema.js";
import type { ModelFailure } from "../loop/model-event.js";
import { createBufferedHttp } from "./buffered-http.js";
import { createChatClient } from "./chat-completions-transport.js";
import { chatFailureFacts, chatFailureOf } from "./chat-failure.schema.js";
import { messagesFailureFacts, messagesFailureOf } from "./messages-failure.schema.js";
import { createMessagesClient } from "./messages-transport.js";
import { baseUrlOf } from "./model-transport-for.js";
import type { FailureFacts, ProviderFailure } from "./provider-failure.schema.js";

/**
 * Why a model check failed (decision 0221): the provider refused the key (`bad_key`), has no
 * credit or spending limit left for it (`no_credit`), asked to slow down (`rate_limited`), does not
 * know the model (`unknown_model`), did not answer, or answered with a server error, in time
 * (`unreachable`), or refused the call for another reason, or answered as no model API does
 * (`rejected`).
 */
export type ModelCheckProblem =
  | "bad_key"
  | "no_credit"
  | "rate_limited"
  | "unknown_model"
  | "unreachable"
  | "rejected";

/** The model a check calls: its provider's wire format, base URL and key, and its id there. */
export interface ModelCheckTarget {
  readonly kind: RuntimeProvider["kind"];
  /** None for the API the kind calls by default. */
  readonly baseUrl?: string;
  /** None for a provider called without a key, such as a local one. */
  readonly apiKey?: Secret;
  readonly model: string;
}

/** What a check reaches the provider through, and how long it waits. */
export interface ModelCheckParts {
  readonly http: Http;
  readonly clock: Clock;
  /** How long the provider may take to answer, in milliseconds. */
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

// The words of the one message a check sends; the answer is read only for its shape.
const greeting = "Hi";
// Some OpenAI-compatible servers refuse fewer than 16 output tokens; Messages takes 1.
const chatOutputTokens = 16;
const messagesOutputTokens = 1;

// A model API's answer, by its documented shape: a page or another JSON at the address is not one.
const chatAnswerSchema = z.looseObject({ choices: z.array(z.looseObject({})) });
const messagesAnswerSchema = z.looseObject({ type: z.literal("message") });

// Codes and words that say the provider does not know the model; the words only pick the problem.
const unknownModelCodes: ReadonlySet<string> = new Set(["model_not_found", "invalid_model"]);
const modelWords = /\bmodels?\b/i;
const missingWords =
  /not found|does not exist|not (?:a )?valid|unknown|invalid|no such|not available/i;

function isUnknownModel(facts: FailureFacts): boolean {
  const words = facts.words ?? "";
  if (facts.code !== undefined && unknownModelCodes.has(facts.code)) {
    return true;
  }
  if (facts.status === 404) {
    return modelWords.test(words);
  }
  const isRefusal = facts.status === 400 || facts.status === 422;
  return isRefusal && modelWords.test(words) && missingWords.test(words);
}

function refusedProblem(facts: FailureFacts): ModelCheckProblem {
  return isUnknownModel(facts) ? "unknown_model" : "rejected";
}

// Each failure class as the problem a check names; a 429 that waiting ends is rate limiting.
const problems: Readonly<Record<ModelFailure, (facts: FailureFacts) => ModelCheckProblem>> = {
  auth: () => "bad_key",
  billing: () => "no_credit",
  transient: (facts) => (facts.status === 429 ? "rate_limited" : "unreachable"),
  aborted: () => "unreachable",
  context: refusedProblem,
  request: refusedProblem,
  refused: refusedProblem,
};

function problemOf(failure: ProviderFailure, facts: FailureFacts): ModelCheckProblem {
  return problems[failure.failure](facts);
}

async function checkChat(
  options: Parameters<typeof createChatClient>[0],
  signal: AbortSignal,
): Promise<Result<void, ModelCheckProblem>> {
  const client = createChatClient(options);
  try {
    const answer = await client.chat.completions.create(
      {
        model: options.model,
        messages: [{ role: "user", content: greeting }],
        max_completion_tokens: chatOutputTokens,
      },
      { signal },
    );
    return chatAnswerSchema.safeParse(answer).success ? ok(undefined) : err("rejected");
  } catch (error) {
    const failure = chatFailureOf(error, { signal, nowMs: options.clock.now() });
    return err(problemOf(failure, chatFailureFacts(error)));
  }
}

async function checkMessages(
  options: Parameters<typeof createMessagesClient>[0],
  signal: AbortSignal,
): Promise<Result<void, ModelCheckProblem>> {
  const client = createMessagesClient(options);
  try {
    const answer = await client.messages.create(
      {
        model: options.model,
        messages: [{ role: "user", content: greeting }],
        max_tokens: messagesOutputTokens,
      },
      { signal },
    );
    return messagesAnswerSchema.safeParse(answer).success ? ok(undefined) : err("rejected");
  } catch (error) {
    const failure = messagesFailureOf(error, { signal, nowMs: options.clock.now() });
    return err(problemOf(failure, messagesFailureFacts(error)));
  }
}

/**
 * Checks a model with one small live call through the official client of its kind (decision
 * 0221): one non-streamed message asking for at most 16 output tokens on Chat Completions, 1 on
 * Messages, so it costs a fraction of a cent. It proves the key, the credit, the model and the
 * address at once, and answers what went wrong as a {@link ModelCheckProblem}. The key goes only
 * into the request's header, and no answer, problem or fault carries it. It never throws for an
 * answer the provider gave.
 */
export async function checkModel(
  target: ModelCheckTarget,
  parts: ModelCheckParts,
): Promise<Result<void, ModelCheckProblem>> {
  const options = {
    baseUrl: baseUrlOf(target),
    ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey.reveal() }),
    model: target.model,
    timeoutMs: parts.timeoutMs,
    http: createBufferedHttp(parts.http),
    clock: parts.clock,
  };
  return target.kind === "anthropic"
    ? checkMessages(options, parts.signal)
    : checkChat(options, parts.signal);
}
