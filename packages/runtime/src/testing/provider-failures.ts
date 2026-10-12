import { anthropicAnswer, openrouterAnswer, type ProviderFailureCase } from "./failure-answers.js";
import { openaiFailureCases } from "./openai-failures.js";

const anthropicCases: readonly ProviderFailureCase[] = [
  ...(
    [
      [400, "invalid_request_error", "request", "next"],
      [401, "authentication_error", "auth", "next"],
      [402, "billing_error", "billing", "next"],
      [403, "permission_error", "auth", "next"],
      [404, "not_found_error", "request", "next"],
      [413, "request_too_large", "context", "end"],
      [500, "api_error", "transient", "retry"],
      [504, "timeout_error", "transient", "retry"],
      [529, "overloaded_error", "transient", "retry"],
    ] as const
  ).map(([status, type, failure, step]): ProviderFailureCase => ({
    provider: "anthropic",
    name: `${String(status)} ${type}`,
    answer: anthropicAnswer(status, { type, message: "Words the provider chose." }),
    failure,
    step,
  })),
  {
    provider: "anthropic",
    name: "a prompt over the context window",
    answer: anthropicAnswer(400, {
      type: "invalid_request_error",
      message: "prompt is too long: 208310 tokens > 200000 maximum",
    }),
    failure: "context",
    step: "end",
  },
  {
    provider: "anthropic",
    name: "the rate limit with retry-after",
    answer: anthropicAnswer(
      429,
      { type: "rate_limit_error", message: "Number of request tokens has exceeded your limit." },
      { "retry-after": "30" },
    ),
    failure: "transient",
    retryAfterMs: 30_000,
    step: "retry",
  },
  {
    provider: "anthropic",
    name: "an overloaded error event in the middle of the stream",
    answer: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-sonnet-5-5","stop_reason":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      ],
    },
    failure: "transient",
    step: "retry",
  },
];

const openrouterCases: readonly ProviderFailureCase[] = [
  ...(
    [
      [400, "request", "next"],
      [401, "auth", "next"],
      [402, "billing", "next"],
      [408, "transient", "retry"],
      [502, "transient", "retry"],
    ] as const
  ).map(([status, failure, step]): ProviderFailureCase => ({
    provider: "openrouter",
    name: `a ${String(status)}`,
    answer: openrouterAnswer(status, { message: "Words the provider chose." }),
    failure,
    step,
  })),
  {
    provider: "openrouter",
    name: "a 402 of the in-flight budget, with Retry-After",
    answer: openrouterAnswer(
      402,
      {
        message: "Too many requests in flight for this key.",
        metadata: { limit_source: "openrouter_in_flight_budget" },
      },
      { "retry-after": "5" },
    ),
    failure: "transient",
    retryAfterMs: 5_000,
    step: "retry",
  },
  {
    provider: "openrouter",
    name: "input its moderation flagged",
    answer: openrouterAnswer(403, {
      message: "Your chosen model requires moderation and your input was flagged",
      metadata: {
        reasons: ["violence"],
        flagged_input: "Words the owner wrote...",
        provider_name: "OpenAI",
        model_slug: "openai/gpt-5-mini",
      },
    }),
    failure: "refused",
    step: "end",
  },
  {
    provider: "openrouter",
    name: "the rate limit with Retry-After",
    answer: openrouterAnswer(429, { message: "Rate limit exceeded" }, { "retry-after": "10" }),
    failure: "transient",
    retryAfterMs: 10_000,
    step: "retry",
  },
  {
    provider: "openrouter",
    name: "no provider for the routing, with Retry-After",
    answer: openrouterAnswer(
      503,
      { message: "No available model provider meets your routing requirements" },
      { "retry-after": "3" },
    ),
    failure: "transient",
    retryAfterMs: 3_000,
    step: "retry",
  },
  {
    provider: "openrouter",
    name: "a request over the context window, in words only",
    answer: openrouterAnswer(400, {
      message:
        "This endpoint's maximum context length is 200000 tokens. However, you requested about 231044 tokens.",
    }),
    failure: "context",
    step: "end",
  },
  {
    provider: "openrouter",
    name: "a provider error in the middle of the stream",
    answer: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [
        'data: {"id":"gen-1","object":"chat.completion.chunk","created":1760000000,"model":"openai/gpt-5-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Che"},"finish_reason":null}]}\n\n',
        'data: {"id":"gen-1","object":"chat.completion.chunk","created":1760000000,"model":"openai/gpt-5-mini","provider":"OpenAI","error":{"code":502,"message":"Provider returned error","metadata":{"error_type":"provider_unavailable"}},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}\n\n',
      ],
    },
    failure: "transient",
    step: "retry",
  },
];

/** Every documented failure of OpenAI, Anthropic and OpenRouter the transports class. */
export const providerFailureCases: readonly ProviderFailureCase[] = [
  ...openaiFailureCases,
  ...anthropicCases,
  ...openrouterCases,
];
