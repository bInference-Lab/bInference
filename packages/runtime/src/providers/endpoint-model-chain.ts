import type { Clock, Http, Secret } from "@binference/core";
import type { ModelChain } from "../loop/ports.js";
import { createBufferedHttp } from "./buffered-http.js";
import { createChatCompletionsTransport } from "./chat-completions-transport.js";
import { createModelChain } from "./model-chain.js";

/** One model at an OpenAI-compatible endpoint: its base URL, its key and its id there. */
export interface ModelEndpoint {
  /** The endpoint's base URL, such as `https://api.openai.com/v1`. */
  readonly baseUrl: string;
  /** None for an endpoint called without a key, such as a local one. */
  readonly apiKey?: Secret;
  readonly model: string;
}

/** What an endpoint's chain reaches it through, and how long it waits for an answer to start. */
export interface EndpointChainParts {
  readonly http: Http;
  readonly clock: Clock;
  readonly timeoutMs: number;
}

// How long a failing endpoint rests, as `models.cooldownMs` does by default.
const endpointCooldownMs = 60_000;

/**
 * A chain of the one model at an endpoint, in the Chat Completions format, with no fallback, for
 * the model evaluation; a failing endpoint rests for a minute. Each answer is read whole before the turn
 * reads it. The key leaves its `Secret` only for the request's header, never for a log or an
 * error.
 */
export function endpointModelChain(endpoint: ModelEndpoint, parts: EndpointChainParts): ModelChain {
  const transport = createChatCompletionsTransport({
    baseUrl: endpoint.baseUrl,
    ...(endpoint.apiKey === undefined ? {} : { apiKey: endpoint.apiKey.reveal() }),
    model: endpoint.model,
    timeoutMs: parts.timeoutMs,
    http: createBufferedHttp(parts.http),
    clock: parts.clock,
  });
  return createModelChain([{ name: `endpoint/${endpoint.model}`, transport }], {
    clock: parts.clock,
    cooldownMs: endpointCooldownMs,
    until: new Map<string, number>(),
  });
}
