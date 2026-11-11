# 0411. The agent calls APIs with stored credentials it never sees

Status: Accepted

Accepted by the owner on 2026-11-11.

## Context

[Decision 0388](../DECISIONS.md#d0388) keeps the owner's credentials in the engine, each with the
exact hosts it may be sent to, and left the step that uses them for later. Today a credential
serves only a config key ([decision 0390](../DECISIONS.md#d0390)): the agent cannot call a data
provider's API with the key the owner stored for it, and the shell would need the value in a
command, where the agent and the command's output would see it. The owner chose that the agent
uses a stored credential only through a tool where binference makes the request itself and puts
the value in, for the hosts the owner allowed: no proxy, no certificate, nothing decrypted.

## Decision

- **The operation.** `http/request` (protocol version 1, scope `agent`, no idempotency key, so no
  answer is stored) answers only the runtime the engine runs now. It takes a method (`GET`,
  `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE`), an `https:` URL of at most 2,048 characters, up to
  32 headers, a text body of at most 256 KiB for the methods that carry one, and a time limit of 1
  to 25 seconds, 20 when absent: the engine answers each call within 30 seconds, so a longer wait
  cannot fit one call.
- **Where it may go.** The URL passes the guard `read_page` and `image/view` use: a public host,
  no user name or password, every address the host resolves to public at connect time. Plain
  `http:` is refused, and so is the host of `remote.publicUrl`, binference's own address on the
  internet. Requests go by the owner's proxy route ([decision 0347](../DECISIONS.md#d0347)).
  Redirects are never followed: a `3xx` answers its status and `location`, and the agent calls
  again, so each host is judged on its own.
- **Headers.** A name is an HTTP token of at most 100 characters, each name once. `host`,
  `content-length`, `connection`, `keep-alive`, `proxy-connection`, `proxy-authorization`,
  `proxy-authenticate`, `te`, `trailer`, `transfer-encoding`, `upgrade`, `expect`,
  `http2-settings` and `user-agent` are refused: the HTTP library sets them, and binference names
  itself in every request. A value holds no line break or control character.
- **Stand-ins.** `{{credential:NAME}}` stands for a stored credential in a header's value, in the
  URL's query and in the body, nowhere else: one in the host, the path or the fragment refuses the
  request. A text that starts a stand-in but does not finish one with a credential's name refuses
  it too. The value goes in as it is in a header and in the body, and percent-encoded in the
  query.
- **Hosts and ports.** A credential goes only to a host it lists, matched exactly after the URL's
  own lower-casing and with a trailing dot dropped: `api.example.com` covers neither
  `eu.api.example.com` nor `example.com`, so the owner lists each host. It goes only on the
  default port 443; a URL that names another port gets no credential.
- **Refusals before anything is sent.** A stand-in for a credential that is not stored, or whose
  hosts leave out the URL's host, refuses the whole request, and the answer names the credential
  and the host. The owner adds a host by storing the credential again with it
  (`binference credential set NAME --allow-host ...`), or by answering the agent's request that
  proposes it. A value a header cannot carry refuses the request too. These refusals are answers of
  kind `refused`, not error codes, so they carry the names.
- **Writes in a marked turn.** A request with a stand-in and a method other than `GET` or `HEAD`,
  in a turn marked as outside content, is refused (`credential_outside`), and the agent tells the
  owner to ask again after `/clear`. The engine judges the mark itself: the runtime's call carries
  the mark of its running turn, as a proposal does, and a call with no mark counts as marked. Words
  a page, a post or an earlier answer put in the context must never choose to post, order or delete
  on the owner's account. A read with a credential still runs in such a turn: it reaches only the
  hosts the owner allowed and changes nothing there by the HTTP rules.
- **The answer.** The status; at most 16 headers of the answer: `content-type`, `content-length`,
  `location`, `retry-after` and the rate-limit headers (`ratelimit*`, `x-ratelimit-*`,
  `x-rate-limit-*`), each value at most 500 characters; the body as text, at most 10,000
  characters, cut with a mark, so it fits a tool result; and how long it took. A body of a type
  that is not text (by `content-type`, or by its bytes when the answer names none) is answered by
  its type and size only. A `HEAD` answer has no body.
- **Masking.** Before the agent reads an answer, each value the request carried, as it is and
  percent-encoded, is replaced by its stand-in in the headers and the body, before the body is
  cut. A failure is answered by its error code alone, so no value can reach one.
- **Outside content.** Every answer the site gave is outside content and marks the turn. A
  refusal binference wrote does not.
- **Error codes**, additions to protocol version 1: `request.unavailable` (an engine that sends no
  requests), `request.address_refused`, `request.unreachable`, `request.timed_out`,
  `request.too_large` (an answer past 8 MiB) and `request.proxy_held`.
- **The log.** One line per request sent, `request.sent` or `request.failed`, with the method, the
  host, the status or the error code and the time it took, never the path, the query, a header or
  the body. Log lines gain the fields `method`, `host` and `status`; the support bundle keeps the
  method and the status and hides the host.
- **The tool.** `http_request`, a machine tool the agent's own turns get and helpers never do:
  helpers read and report, and a credential is used only in a turn of the chat the owner reads.
  Its description tells the model to write stand-ins and never to ask for a value in the chat; the
  `credentials` tool points to it.
- **No setting.** The tool has no switch of its own. Without a credential it reaches what the
  shell already reaches, and a credential goes only where its owner listed a host. The owner stops
  a credential's use by removing it, or by storing it with no host.

## Consequences

- The agent calls an API with the owner's key without seeing, logging or storing it; the value
  lives only in the engine's memory for the one request.
- An API that echoes a key in a changed form, such as base64, is not masked; one that takes a key
  only in a URL path, or in a header the agent cannot build from the value alone, such as Basic
  authentication over a user name and a password, cannot be called with a stand-in.
- A turn that read outside content, the answer of an earlier request included, makes no write
  with a credential; the owner clears the chat and asks again.
- A `GET` an API wrongly uses to change something still runs in a marked turn.
- A request takes at most 25 seconds; a slower API cannot be called.

## Alternatives

- **A proxy that puts the values into every program's traffic.** It needs a certificate the
  programs trust and decrypts their TLS; the owner chose a request binference makes itself.
- **Follow redirects.** A redirect to another host would carry the credential where its owner
  never listed it, or drop it without saying; answering the `3xx` keeps every host judged.
- **Refuse every request with a credential in a marked turn.** It would stop the agent reading an
  API after it read a page; a read reaches only an allowed host and moves nothing.
