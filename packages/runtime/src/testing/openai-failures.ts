import { openaiAnswer, type ProviderFailureCase } from "./failure-answers.js";

/** The failures OpenAI's error codes guide documents. */
export const openaiFailureCases: readonly ProviderFailureCase[] = [
  {
    provider: "openai",
    name: "an incorrect API key",
    answer: openaiAnswer(401, {
      message: "Incorrect API key provided: sk-abc. You can find your API key at the dashboard.",
      type: "invalid_request_error",
      code: "invalid_api_key",
    }),
    failure: "auth",
    step: "next",
  },
  {
    provider: "openai",
    name: "an account outside an organization",
    answer: openaiAnswer(401, {
      message: "You must be a member of an organization to use the API.",
      type: "invalid_request_error",
      code: null,
    }),
    failure: "auth",
    step: "next",
  },
  {
    provider: "openai",
    name: "an unsupported country",
    answer: openaiAnswer(403, {
      message: "Country, region, or territory not supported",
      type: "request_forbidden",
      code: "unsupported_country_region_territory",
    }),
    failure: "auth",
    step: "next",
  },
  {
    provider: "openai",
    name: "the request rate limit with Retry-After",
    answer: openaiAnswer(
      429,
      {
        message: "Rate limit reached for requests on gpt-5-mini. Please try again in 20s.",
        type: "requests",
        code: "rate_limit_exceeded",
      },
      { "retry-after": "20" },
    ),
    failure: "transient",
    retryAfterMs: 20_000,
    step: "retry",
  },
  {
    provider: "openai",
    name: "slow down, with Retry-After in milliseconds",
    answer: openaiAnswer(
      429,
      {
        message: "Please reduce your rate of requests.",
        type: "rate_limit_error",
        code: "slow_down",
      },
      { "retry-after-ms": "1500" },
    ),
    failure: "transient",
    retryAfterMs: 1_500,
    step: "retry",
  },
  ...[
    "insufficient_quota",
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
  ].map((code): ProviderFailureCase => ({
    provider: "openai",
    name: `a 429 for spend (${code})`,
    answer: openaiAnswer(429, {
      message: "Words the provider chose.",
      type: "insufficient_quota",
      code,
    }),
    failure: "billing",
    step: "next",
  })),
  {
    provider: "openai",
    name: "a request over the context window",
    answer: openaiAnswer(400, {
      message: "This model's maximum context length is 128000 tokens.",
      type: "invalid_request_error",
      code: "context_length_exceeded",
    }),
    failure: "context",
    step: "end",
  },
  {
    provider: "openai",
    name: "a service tier the project may not use",
    answer: openaiAnswer(400, {
      message: "Invalid service_tier argument.",
      type: "invalid_request_error",
      code: null,
    }),
    failure: "request",
    step: "next",
  },
  {
    provider: "openai",
    name: "a model that does not exist",
    answer: openaiAnswer(404, {
      message: "The model `gpt-9` does not exist or you do not have access to it.",
      type: "invalid_request_error",
      code: "model_not_found",
    }),
    failure: "request",
    step: "next",
  },
  {
    provider: "openai",
    name: "a server error",
    answer: openaiAnswer(500, {
      message: "The server had an error while processing your request.",
      type: "server_error",
      code: null,
    }),
    failure: "transient",
    step: "retry",
  },
  {
    provider: "openai",
    name: "an overloaded model asking for more than a minute",
    answer: openaiAnswer(
      503,
      {
        message: "The model is currently overloaded.",
        type: "service_unavailable_error",
        code: "server_is_overloaded",
      },
      { "retry-after": "90" },
    ),
    failure: "transient",
    retryAfterMs: 90_000,
    step: "next",
  },
];
