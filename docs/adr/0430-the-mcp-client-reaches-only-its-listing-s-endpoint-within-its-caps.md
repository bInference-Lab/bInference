# 0430. The MCP client reaches only its listing's endpoint, within its caps

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

[Decision 0428](0428-the-cloud-agent-calls-listed-mcp-servers-as-read-tools-that-mark-every-turn.md)
puts an MCP client in the agent runtime for the servers bInference lists. The official SDK's
Streamable HTTP client transport sends a `POST` per message and, after the handshake, opens a `GET`
stream for what a server sends on its own. Left to its defaults, it uses the global `fetch`,
follows a redirect that stays on one origin, reads an answer of any size, and after a `401` or a
`403` may fetch the authorization servers a header names.

[ENGINEERING.md section 13](../ENGINEERING.md#section-13) sends every outbound request through
the `Http` port and every URL from outside through the URL guard.
[Decision 0347](0347-every-outbound-request-goes-through-the-owner-s-proxy-and-none-goes-around-it.md)
sends them by the proxy route in force, which on Cloud is the workers' guarded exit.
[Decision 0417](0417-outside-json-nested-past-64-levels-is-refused-before-anything-walks-it.md)
refuses outside JSON nested past 64 levels before anything walks it.

## Decision

- **One fetch.** The transport gets a fetch of binference's over the runtime's outbound HTTP with
  `publicOnly` set, so each request goes by the route in force and connects only to the public
  addresses the listed host resolves to at connect time. While the route holds requests, as when
  the proxy cannot be read, the call answers `unreachable` and nothing goes out. The SDK never
  falls back to the global `fetch`.
- **One address.** The fetch sends only to the listing's `url`, exactly: another scheme, host,
  port, path or query is `refused` before anything is sent. A `3xx` is never followed and answers
  `refused`.
- **`POST` only.** The fetch sends `POST`, and `DELETE` when it closes a connection that has a
  session. It answers a `GET` itself with `405`, which the transport reads as a server without a
  stream, so no request stays open for what a server sends unasked. The client never asks for list
  changes, and never answers a server: a `POST` that names no method, a reply, is answered `202`
  here and never sent.
- **Headers.** Only `accept`, `content-type`, `mcp-session-id`, `mcp-protocol-version` and the
  request headers of the `2026-07-28` revision that start with `mcp-`, beside binference's
  `user-agent`. A `set-cookie` in an answer is dropped.
- **Caps per answer.** The fetch reads each answer whole before the transport sees it, at most the
  listing's `maxBytes`: past them it stops reading, closes the connection, and the call answers
  `too_large`. An answer whose type is neither `application/json` nor `text/event-stream`, or whose
  JSON, or the data of any of its events, nests past 64 levels, or that carries a request of the
  server's, answers `bad_answer`, and the SDK never parses it. A notice of the server's, with no
  id, is left to the SDK, which reads none. A status other than `2xx` answers `unreachable` with the status, `429`
  `rate_limited`.
- **Timeouts.** A connection, its handshake and its tool list included, has 10 seconds. Each call
  has the listing's `timeoutMs`, at most 20 seconds, and progress notices never extend it. The
  turn's abort ends both. A connection and a call fit together in the 60 seconds of a read tool
  ([spec 8, section 5.2](../specs/runtime.md#section-5-2)). Past either, the call answers
  `timed_out`. Each request has a deadline of its own as well: a call's for `tools/call`, the
  connection's 10 seconds for any other, 2 seconds for a session's end. At most 8 requests of one
  connection are in flight; the fetch refuses the next one, unsent, as `busy`.
- **The handshake** is the SDK's `initialize` for a listing of a 2025 revision, and the `2026-07-28`
  revision pinned, with no probe and no fallback, for a listing that names it. The client offers
  the listing's revision alone: a server that settles on another answers `bad_answer`. The SDK
  refuses every request the server's capabilities do not offer, so a server that advertises no
  `tools` answers `bad_answer` and the SDK never answers in its place.
- **Connections.** One per agent and listing, opened at the agent's first call to one of its tools,
  and closed after 5 minutes without a call, at a new version of the listing, at its revocation and
  when the runtime stops. The `DELETE` that ends a session has 2 seconds, and its answer is not
  read.
- **Errors.** A transport or protocol failure is answered by binference's reason alone. The SDK's
  message, which can quote a server's words, never reaches a result or a log.

## Consequences

- A listed server reaches the agent only through the answers to the agent's own calls, each read
  whole and bounded before any parser walks it.
- A server that answers only through its `GET` stream, or takes more than 20 seconds to answer,
  cannot be listed.
- On Cloud, every listed call leaves through the workers' guarded exit, as every other request of a
  worker does.

## Alternatives

- **The SDK's own fetch.** It would use the global `fetch`, follow redirects on one origin, read
  unbounded answers, and reach hosts an authorization header names.
- **Keep the `GET` stream for list changes.** One open stream per agent and server, which the
  server can fill at will; the client reads the list again at each connection instead.
- **Hand the transport each answer as it streams.** The depth check needs the whole text, and the
  caps keep it small enough to hold.
- **Follow redirects on the same origin.** Another path on the same host is a place the review
  never read.
- **30 seconds to connect and 60 for a call.** Together they would pass a read tool's 60 seconds,
  and a stalled server would hold a call that long on a Cloud worker.
