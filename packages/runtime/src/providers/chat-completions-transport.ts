import type { Clock } from "@binference/core";
import { OpenAI } from "openai";
import type { ModelEvent } from "../loop/model-event.js";
import type { ModelTransport } from "../loop/ports.js";
import type { ModelRequest } from "../loop/turn-records.js";
import { chatFailureOf } from "./chat-failure.schema.js";
import { chatPayloadOf } from "./chat-payload.js";
import { createModelFetch } from "./model-fetch.js";
import type { StreamingHttp } from "./ports.js";
import { reduceChatStream } from "./reduce-chat-stream.js";

/** One Chat Completions model at one provider, and what the transport reaches it through. */
export interface ChatCompletionsOptions {
  /** The provider's base URL, such as `https://api.openai.com/v1`. */
  readonly baseUrl: string;
  /** The provider's key; a provider without one is called without an `authorization` header. */
  readonly apiKey?: string;
  /** The model's id at the provider. */
  readonly model: string;
  /** How long the provider may take to start its answer, in milliseconds. */
  readonly timeoutMs: number;
  readonly http: StreamingHttp;
  readonly clock: Clock;
}

// The client refuses to start without a key; a provider called without one gets this text, which
// the fetch never sends.
const noKey = "no-key";

const silentLogger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

// The one place a Chat Completions client is built (check:model-clients). Every option is set, so
// no environment variable the client reads (OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_ORG_ID,
// OPENAI_PROJECT_ID, OPENAI_ADMIN_KEY, OPENAI_WEBHOOK_SECRET, OPENAI_LOG) changes a call; the
// headers OPENAI_CUSTOM_HEADERS would add never pass the fetch's allowlist.
function clientOf(options: ChatCompletionsOptions): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey ?? noKey,
    adminAPIKey: null,
    organization: null,
    project: null,
    webhookSecret: null,
    baseURL: options.baseUrl,
    dataResidency: null,
    timeout: options.timeoutMs,
    maxRetries: 0,
    fetch: createModelFetch({
      http: options.http,
      baseUrl: options.baseUrl,
      withKey: options.apiKey !== undefined,
    }),
    fetchOptions: {},
    defaultHeaders: {},
    defaultQuery: {},
    logLevel: "off",
    logger: silentLogger,
    dangerouslyAllowBrowser: false,
  });
}

async function* streamOf(
  client: OpenAI,
  call: { readonly request: ModelRequest; readonly model: string; readonly clock: Clock },
  signal: AbortSignal,
): AsyncGenerator<ModelEvent, void, undefined> {
  try {
    const chunks = await client.chat.completions.create(
      chatPayloadOf(call.request, { model: call.model }),
      { signal },
    );
    yield* reduceChatStream(chunks, signal);
  } catch (error) {
    const failure = chatFailureOf(error, { signal, nowMs: call.clock.now() });
    yield { type: "error", ...failure };
  }
}

/**
 * A {@link ModelTransport} over the official `openai` client's Chat Completions, for the
 * `binference` and `openai` provider kinds (runtime spec, section 8.1): no retries, no logging,
 * no setting from the environment, and every request through {@link createModelFetch}. Each call
 * streams its answer reduced into the loop's events and ends with one `done` or one classified
 * `error`; it never throws.
 */
export function createChatCompletionsTransport(options: ChatCompletionsOptions): ModelTransport {
  const client = clientOf(options);
  return {
    stream: (request, signal) =>
      streamOf(client, { request, model: options.model, clock: options.clock }, signal),
  };
}
