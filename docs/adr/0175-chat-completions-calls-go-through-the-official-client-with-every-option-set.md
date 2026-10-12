# 0175. Chat Completions calls go through the official client with every option set

Status: Amended by 0187

Accepted by the owner on 2026-10-12.

## Context

[Spec 8](../specs/runtime.md) section 8.1 gives the `binference` and `openai` provider kinds a
transport on the official `openai` client: every option set, retries 0, logging off, a timeout, and
the runtime's own `fetch` with allowlisted headers. Section 8.2 names the failure classes, and
section 7.1 asks each transport to mark the end of the stable prefix and of the history for
providers that take explicit cache marks. Some cases are left open:

- **The network.** The core `Http` port answers a whole body, at most 8 MiB, once it has arrived.
  A model's answer streams for minutes, and the idle timeout of section 8.1 needs each piece as it
  comes. The runtime process has no outbound adapter at all.
- **The client's environment.** The client reads `OPENAI_BASE_URL`, `OPENAI_API_KEY`,
  `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_ADMIN_KEY`, `OPENAI_WEBHOOK_SECRET` and `OPENAI_LOG`
  for any option left out, and adds the headers of `OPENAI_CUSTOM_HEADERS` to every request unless
  a provider object is set. It sends headers that name the OS, the CPU and the runtime.
- **The request.** The output limit has two fields (`max_tokens` is deprecated and refused by
  reasoning models), Chat Completions has no field for a response's reasoning, and the tools' JSON
  Schema carries a `$schema` line some providers refuse.
- **Cache marks.** Which models take them on a Chat Completions request, and where.
- **The answer.** Gateways add a reasoning text, a cost on the usage and error events in the
  middle of a stream; some compatible servers leave out a tool call's index or id. A gateway's
  context overflow may have no code, only words.
- **Failures.** The table of section 8.2 names statuses, not the documented codes that cross them
  (a 429 `insufficient_quota` is a billing failure), and not the statuses it leaves out (408, 409,
  413, other 4xx and 5xx).

## Decision

- **A streaming port.** The model transports reach the network through `StreamingHttp`, which
  answers a request's status and headers at once and streams its body, and rejects with
  `http.unreachable` when no answer comes. The runtime process binds it to undici with a pool of
  its own: it follows no redirect, names binference in the user agent, and serves no `publicOnly`
  request, since local model servers are allowed.
- **The client.** `runtime/src/providers/` builds each client with the key (a placeholder for a
  provider without one), the base URL, no organization, project, admin key, webhook secret or data
  residency, `maxRetries: 0`, `logLevel: "off"` with a silent logger, `models.idleTimeoutMs` as the
  time to the answer's headers, empty default headers and query, and our own `fetch`. That `fetch`
  sends only POST requests under the provider's base URL, with a JSON text body and the client's
  signal, carrying only `accept`, `content-type` and, when the provider has a key, `authorization`;
  anything else is refused with `runtime.model_request_refused` before it leaves. So no `OPENAI_*`
  variable changes a call, and `check:model-clients` keeps every model client in that folder.
- **The base URLs.** The `binference` kind calls `https://binference.io/api/v1` and the `openai`
  kind `https://api.openai.com/v1` when the config names none. `models.main` is
  `<provider>/<model>`, split at its first slash. Until the Messages transport lands, the
  `anthropic` kind, a missing role model and an unknown provider answer every call as a `request`
  failure that names why.
- **The request.** The instructions are the system message, then the conversation; tools only when
  there are some, each with its schema less the `$schema` line; `max_completion_tokens: 4096`;
  `stream: true` with `stream_options.include_usage`. A response's reasoning is not sent back. A
  call with empty arguments goes back as `{}`, and an assistant message with calls and no text has
  `null` content.
- **Cache marks.** A model whose id starts with `anthropic/` gets two ephemeral marks, each on a
  message's text as one text part: the system message, which ends the stable prefix (the tools
  come before it in the cached order), and the last owner or tool message with text, which ends the
  history. No other model gets a mark; their providers cache a repeated prefix on their own.
- **The answer.** Each chunk is read with zod. Reasoning comes from `reasoning` or
  `reasoning_content`; a model's `refusal` text is text. A tool call piece without an index starts
  a new call when it has an id and adds to the latest call otherwise; a call without an id gets the
  answer's id and its index. `stop` and any unknown reason end `end`, or `tool_calls` when the
  response made calls; `length` ends `length`; `content_filter` is a `refused` failure; `error` and
  a stream that ends with no reason are `transient`, or `aborted` when the signal stopped it. Usage
  comes from the last chunk; `usage.cost` in US dollars, when present on either kind, becomes
  micro-dollars rounded up.
- **Failures.** By documented code first: `context_length_exceeded` is `context`;
  `insufficient_quota`, `insufficient_balance` and `key_limit` are `billing`; `content_filter` and
  `content_policy_violation` are `refused`. Then by status: 413 `context`; 401 and 403 `auth`; 402
  `billing`; 408, 409, 429 and every 5xx `transient`; every other status `request`, unless its
  words say the request is over the context window, which makes it `context`. An error event in the
  middle of a stream is classed by its code, a numeric code as a status, else `transient`. No answer,
  no answer in time and an unreadable stream are `transient`; a stop is `aborted`. A `transient`
  failure carries the wait the provider asked for, from `retry-after-ms` or `retry-after` in seconds
  or as a date. A failure's message names the status and a well-formed code, never the provider's
  words.

## Consequences

- A stray environment variable, a header a library adds, or a redirect never reaches a provider;
  the owner's key goes only to the base URL the config names.
- The retry and fallback policy reads one failure class and one wait per failed call, whatever the
  provider.
- Anthropic's models served through the gateway read the agent's stable prefix and history from
  cache from the second call of a turn.
- A gateway's cost is the budget's first source; the price table covers a provider that reports
  none.
- The runtime bundles undici, and closes its pool when it ends.

## Alternatives

- **Stream over the core `Http` port.** It buffers whole answers, so no piece could reach the turn
  before the answer ended, and the idle timeout could not work. Rejected.
- **Node's global `fetch` in the runtime.** It follows the process's global dispatcher, which a
  test or a library can replace for every caller at once. Rejected for a pool of the adapter's own.
- **Leave the client's environment to the empty environment the engine gives the runtime.** A
  runtime started any other way, such as from a developer's shell, would read it. Rejected for
  options that need no environment at all.
- **`max_tokens`.** Deprecated, and refused by reasoning models; the gateway reads both. Rejected.
- **Cache marks for any model named after Claude.** A provider's own compatible endpoint may
  refuse fields it does not know. Rejected for the gateway's `anthropic/` ids alone.
- **Class failures by words alone.** Words change without notice; codes are documented. Words are
  read only to tell a context overflow among refused requests that carry no code.
