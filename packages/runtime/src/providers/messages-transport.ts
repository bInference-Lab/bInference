import Anthropic from "@anthropic-ai/sdk";
import type { Clock } from "@binference/core";
import type { ModelEvent } from "../loop/model-event.js";
import type { ModelTransport } from "../loop/ports.js";
import type { ModelRequest } from "../loop/turn-records.js";
import { messagesFailureOf } from "./messages-failure.schema.js";
import { messagesPayloadOf } from "./messages-payload.js";
import { createModelFetch } from "./model-fetch.js";
import type { StreamingHttp } from "./ports.js";
import { reduceMessagesStream } from "./reduce-messages-stream.js";

/** One Messages model at one provider, and what the transport reaches it through. */
export interface MessagesOptions {
  /** The provider's base URL, such as `https://api.anthropic.com`; requests go to `/v1/messages`. */
  readonly baseUrl: string;
  /** The provider's key; a provider without one is called without an `x-api-key` header. */
  readonly apiKey?: string;
  /** The model's id at the provider. */
  readonly model: string;
  /** How long the provider may take to start its answer, in milliseconds. */
  readonly timeoutMs: number;
  readonly http: StreamingHttp;
  readonly clock: Clock;
}

/** The Messages API version every request names, the one Anthropic documents. */
const apiVersion = "2023-06-01";

// The client refuses to start without a credential, and would look for one in the environment
// and on disk; a provider called without a key gets this text, which the fetch never sends.
const noKey = "no-key";

const silentLogger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
};

/**
 * The one place a Messages client is built (check:model-clients), for the transport and the model
 * check. Every option is set, so no variable the client reads (ANTHROPIC_API_KEY,
 * ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_PROFILE, ANTHROPIC_CONFIG_DIR,
 * ANTHROPIC_WEBHOOK_SIGNING_KEY, ANTHROPIC_LOG, nor the workload identity ones) and no credential
 * file changes a call, and the headers ANTHROPIC_CUSTOM_HEADERS would add never pass the fetch,
 * which sets the key and version itself.
 */
export function createMessagesClient(options: MessagesOptions): Anthropic {
  return new Anthropic({
    apiKey: options.apiKey ?? noKey,
    authToken: null,
    credentials: null,
    config: null,
    webhookKey: null,
    baseURL: options.baseUrl,
    timeout: options.timeoutMs,
    maxRetries: 0,
    fetch: createModelFetch({
      http: options.http,
      baseUrl: options.baseUrl,
      headers: {
        "anthropic-version": apiVersion,
        ...(options.apiKey === undefined ? {} : { "x-api-key": options.apiKey }),
      },
    }),
    fetchOptions: {},
    middleware: [],
    defaultHeaders: {},
    defaultQuery: {},
    logLevel: "off",
    logger: silentLogger,
    dangerouslyAllowBrowser: false,
  });
}

async function* streamOf(
  client: Anthropic,
  call: { readonly request: ModelRequest; readonly model: string; readonly clock: Clock },
  signal: AbortSignal,
): AsyncGenerator<ModelEvent, void, undefined> {
  try {
    const events = await client.messages.create(
      messagesPayloadOf(call.request, { model: call.model }),
      { signal },
    );
    yield* reduceMessagesStream(events, signal);
  } catch (error) {
    const failure = messagesFailureOf(error, { signal, nowMs: call.clock.now() });
    yield { type: "error", ...failure };
  }
}

/**
 * A {@link ModelTransport} over the official `@anthropic-ai/sdk` client's Messages API, for the
 * `anthropic` provider kind (runtime spec, section 8.1; decision 0187): no retries, no logging, no
 * setting or credential from the environment, and every request through {@link createModelFetch}.
 * Each call streams its answer reduced into the loop's events and ends with one `done` or one
 * classified `error`; it never throws.
 */
export function createMessagesTransport(options: MessagesOptions): ModelTransport {
  const client = createMessagesClient(options);
  return {
    stream: (request, signal) =>
      streamOf(client, { request, model: options.model, clock: options.clock }, signal),
  };
}
