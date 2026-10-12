# 0187. Messages calls go through the official client and send thinking back

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 8](../specs/runtime.md) section 8.1 gives the `anthropic` provider kind a transport on the
official `@anthropic-ai/sdk` client, with the contract [decision 0175](../DECISIONS.md#d0175) set
for Chat Completions: every option set, retries 0, logging off, the runtime's own `fetch` with
allowlisted headers, the stream reduced into the loop's events, failures classed, never thrown.
Section 7.1 asks each transport to mark the end of the stable prefix and of the history. This
decision amends 0175 where the two transports share a rule. Some cases
are left open:

- **The client's environment.** The client reads `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_BASE_URL`, `ANTHROPIC_LOG`, `ANTHROPIC_WEBHOOK_SIGNING_KEY` and
  `ANTHROPIC_CUSTOM_HEADERS`, whose headers come after its own and so may replace the key and the
  API version. With no key it looks for credentials of its own: `ANTHROPIC_PROFILE`, a profile file
  under `ANTHROPIC_CONFIG_DIR` or the home folder, and the workload identity variables, which make
  it exchange a token at the base URL.
- **Thinking.** Current Claude models think by default, and some refuse a request that turns
  thinking off. Anthropic's docs ask for a response's thinking blocks to come back unchanged, with
  their signatures, in the calls that follow; dropping or editing them can fail the request. The
  transcript keeps a response's reasoning as text, without signatures.
- **The request's shape.** The API takes the system prompt as text blocks, the tools before it in
  the cached order, at most four cache marks, no empty text block, and a turn's tool results first
  in the user message that follows it.
- **The answer.** The stream has stop reasons Chat Completions lacks (`refusal`,
  `model_context_window_exceeded`, `pause_turn`), counts cached input apart from `input_tokens`, and
  sends running totals in `message_delta`. An error comes as an `error` event in the middle of a
  stream as well as an error answer.
- **Failures.** Anthropic documents an error type for each status, and a context overflow is a 400
  `invalid_request_error` known only by its words.

## Decision

- **The client.** `runtime/src/providers/` builds it with the key (a placeholder for a provider
  without one, so it never looks for a credential), no auth token, credentials, config or profile,
  no webhook key, the base URL, `models.idleTimeoutMs` as the time to the answer's headers,
  `maxRetries: 0`, `logLevel: "off"` with a silent logger, no middleware, empty default headers and
  query, and our own `fetch`. The fetch takes only `accept` and `content-type` from the client and
  sets `anthropic-version: 2023-06-01` and, when the provider has a key, `x-api-key` itself, so no
  variable changes where a call goes or what it carries. The Chat Completions fetch sets its own
  `authorization` the same way. The one warning the client writes past its logger, for a model it
  lists as deprecated, goes to the runtime's standard error, which the engine does not read.
- **The base URL.** The `anthropic` kind calls `https://api.anthropic.com` when the config names
  none; requests go to `<baseUrl>/v1/messages`, as the client builds them.
- **The request.** The instructions are one system text block with an ephemeral cache mark; the
  tools follow the declarations, each schema an object without its `$schema` line, with a mark on
  the last, so the tools stay cached when the instructions change; the conversation alternates user
  and assistant messages, a turn's results first and the owner's messages held behind them after,
  with a mark on the last user block, which ends the history. Empty texts are left out, and a result
  with no text has no content. `max_tokens: 4096`, `stream: true`. Thinking, effort and sampling are
  left to the model's defaults, which every current model accepts.
- **Thinking goes back.** When a response holds a `thinking` or `redacted_thinking` block, the
  transport ends it with a replay: its content blocks in order, thinking with its signature, text,
  and each call with its input as an object (`{}` when its output limit cut it). The loop keeps the
  replay with the response, in the conversation and in the transcript's event, and the Messages
  request sends it back in place of the response's text and calls. A response that did not think
  is written again from its text and calls, the same bytes each time. Chat Completions ignores a
  replay.
- **The answer.** Each event is read with zod. Text and thinking deltas become text and reasoning;
  a `tool_use` block becomes a call at the block's index, its input from `input_json_delta` pieces,
  or whole from the block's start when no piece follows. `max_tokens` and
  `model_context_window_exceeded` end `length`; a response with calls ends `tool_calls`; any other
  stop ends `end`; `refusal` is a `refused` failure naming its category. Usage is the input in all
  (`input_tokens` with the cache's reads and writes), the cache's reads, and the output, the later
  totals replacing the earlier. A stream that ends with no stop reason is `transient`, or `aborted`
  when the signal stopped it.
- **Failures.** By Anthropic's error type first: `authentication_error` and `permission_error`
  `auth`, `billing_error` `billing`, `not_found_error` `request`, `request_too_large` `context`,
  `rate_limit_error`, `api_error`, `timeout_error` and `overloaded_error` `transient`. Then by
  status and words as decision 0175 says, which now count "context limit" among a context
  overflow's words. An `error` event mid-stream is classed by its type. Both transports class
  through `providers/provider-failure.schema.ts`.

## Consequences

- A stray `ANTHROPIC_*` variable, a credential file or a header a library adds never reaches a
  provider; the owner's key goes only to the base URL the config names.
- A thinking model's tool turns keep working on its second call and after a restart, and its
  history goes back byte for byte, so the cache holds.
- The transcript grows by the thinking blocks a response held, which the 4,096 output tokens bound.
- Cache writes count as input at the input price until the budget prices them apart.

## Alternatives

- **Turn thinking off.** Some current models refuse it, and it costs answers their quality.
  Rejected.
- **Drop thinking blocks from earlier responses.** Anthropic's docs say a later call may then fail.
  Rejected.
- **Server-side fallbacks (`fallbacks`).** A beta that would swap a model the owner picked, which
  spec 8 forbids, and would split the fallback policy between the provider and the runtime.
  Rejected; the runtime's chain decides.
- **Eager tool input streaming.** Compatible endpoints a `baseUrl` names may refuse the field, and
  the loop shows no input before the call ends. Rejected for now.
- **A second system block for the volatile tail.** The system prompt comes before the history in
  the cached order, so each new tail would write the history to the cache again. Rejected; spec 8
  section 7.1 puts it after the history.
