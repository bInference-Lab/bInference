# Spec 1: the engine protocol

Status: accepted on 2026-10-06 ([decision 0090](../DECISIONS.md#d0090)), with
[decision 0088](../DECISIONS.md#d0088) and [decision 0089](../DECISIONS.md#d0089); custody
operations follow spec 5 ([decision 0085](../DECISIONS.md#d0085)); amended by decisions
[0104](../DECISIONS.md#d0104), [0125](../DECISIONS.md#d0125), [0128](../DECISIONS.md#d0128),
[0133](../DECISIONS.md#d0133), [0134](../DECISIONS.md#d0134), [0155](../DECISIONS.md#d0155),
[0177](../DECISIONS.md#d0177), [0178](../DECISIONS.md#d0178), [0182](../DECISIONS.md#d0182),
[0183](../DECISIONS.md#d0183), [0184](../DECISIONS.md#d0184), [0185](../DECISIONS.md#d0185), [0189](../DECISIONS.md#d0189), [0190](../DECISIONS.md#d0190), [0207](../DECISIONS.md#d0207), [0208](../DECISIONS.md#d0208), [0220](../DECISIONS.md#d0220), [0243](../DECISIONS.md#d0243), [0244](../DECISIONS.md#d0244), [0245](../DECISIONS.md#d0245), [0246](../DECISIONS.md#d0246), [0247](../DECISIONS.md#d0247), [0248](../DECISIONS.md#d0248), [0255](../DECISIONS.md#d0255), [0256](../DECISIONS.md#d0256), [0285](../DECISIONS.md#d0285), [0286](../DECISIONS.md#d0286), [0296](../DECISIONS.md#d0296), [0297](../DECISIONS.md#d0297), [0298](../DECISIONS.md#d0298) and [0299](../DECISIONS.md#d0299); the agent runtime's operations follow [spec 8](runtime.md) (accepted 2026-10-11). Accepted by the owner on
2026-10-12: the market reads `market/scan`, `market/chart`, `wallet/activity` and `launch/list`;
the agent's questions (`turn/ask`, `chat/answer`); alert conditions and wake-ups, and the cap on
tracked wallets (section 8.4); the pushes `launch/new`, `inbox/alertFired`, `chat/question` and
`chat/questionClosed`; `QuoteView.place`, the P&L fields of `PnlView`, `OrderView.endReason`, the
alert state `ended`, `update/check`'s `releaseNotes`; the id prefix `qst_`; the error areas
`question`, `alert` and `market`, and `wallet.track_limit`.

Accepted by the owner on 2026-10-30: accounts on other chains, Solana's among them
(section 1); the webhook listener's body and rate (section 2.2); `staking/options`, `bridge/quote`
and what `name/resolve` answers and refuses (section 7.3); webhook rules' bounds (section 7.5);
saved addresses on other chains (section 7.6); the permission review of `plugin/add`
(section 7.8); the `remote/*` results and `identity/register`'s description (section 7.9); sends,
stakes and bridges (section 8.1); the staking, bridge and delivery views and the portfolio's
staking and in-transit parts (section 8.3); and the new error codes (section 10). Each is an
addition to protocol v1.

The engine serves one protocol to every client: the agent runtime, the console and Mini App, the CLI
and terminal chat, and the MCP server. The engine is the only server. Every other part of binference
is a client with scopes, and none of them can confirm a transaction unless its scopes say so.

<a id="section-1"></a>

## 1. Conventions

These follow [ENGINEERING.md section 24.1](../ENGINEERING.md#section-24-1) and hold everywhere
below.

| Thing          | Rule                                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoding       | UTF-8 JSON, one object per WebSocket text message                                                                                                                                                                            |
| Amounts        | `{ asset: AssetRef, base: string }`; `base` is a decimal string of base units (`"1500000000000000000"`)                                                                                                                      |
| USD            | `usdMicros: string`, a decimal string of micro-dollars (`"123450000"` is $123.45)                                                                                                                                            |
| Rates          | Integers in basis points (`slippageBps: 50` is 0.5%)                                                                                                                                                                         |
| Times          | Epoch milliseconds in UTC, as numbers, in fields ending `At`                                                                                                                                                                 |
| Ids            | UUIDv7 strings with a type prefix (section 1.1)                                                                                                                                                                              |
| Chain ids      | CAIP-2 `ChainRef` (`eip155:56`), CAIP-10 `AccountRef`, CAIP-19 `AssetRef`; Solana is `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, its accounts base58 and its tokens `…/token:<mint>` ([decision 0298](../DECISIONS.md#d0298)) |
| Optional       | A missing optional field is absent, never `null`                                                                                                                                                                             |
| Unknown fields | Clients ignore fields they do not know; the engine rejects unknown fields in `args`                                                                                                                                          |
| Paging         | Args `{ cursor?: string, limit?: number }` (default 50, at most 200); result `{ items, next?: string }`                                                                                                                      |

<a id="section-1-1"></a>

### 1.1 Id prefixes

| Prefix | Thing              | Prefix | Thing            |
| ------ | ------------------ | ------ | ---------------- |
| `agt_` | agent              | `ord_` | auto order       |
| `wal_` | wallet             | `fil_` | order fill       |
| `int_` | intent             | `alr_` | alert            |
| `crd_` | card               | `whr_` | webhook rule     |
| `cnf_` | confirmation       | `sch_` | schedule         |
| `tx_`  | transaction        | `ses_` | chat session     |
| `led_` | ledger entry       | `trn_` | chat turn        |
| `adr_` | address book       | `dev_` | console device   |
| `tok_` | client token       | `con_` | connection       |
| `job_` | long job           | `bkp_` | backup           |
| `ntc_` | notice             | `plg_` | installed plugin |
| `shj_` | shell job          |        |                  |
| `crq_` | credential request |        |                  |
| `msg_` | inbox message      | `qst_` | agent question   |

<a id="section-2"></a>

## 2. Transports

The engine listens on two transports. Both carry the same frames (section 3) over WebSocket.

| Transport   | Address                                                                                                                          | Who uses it                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Local IPC   | `~/.binference/run/engine.sock` on macOS and Linux; `\\.\pipe\binference-<install id>-engine` on Windows; owner-only permissions | CLI, terminal chat, the agent runtime, `binference mcp` |
| HTTP and WS | `127.0.0.1:7456`, path `/ws` (port in config)                                                                                    | Console in a browser, the Telegram Mini App             |

- The HTTP port binds to loopback only. Tailscale `serve` reaches it through a proxy
  ([ARCHITECTURE.md section 25](../ARCHITECTURE.md#section-25)); the engine never binds a public
  interface.
- **No trust by address.** A connection from loopback or over Tailscale is not trusted for that
  reason; every connection authenticates (section 4).
- **Local-only operations** (marked `local` in section 7) are accepted only over the IPC transport,
  so they need a shell on the machine.
- WebSocket options: no compression; a ping every 20 seconds; the connection closes after 60 seconds
  without a pong.
- Limits: 1 MiB per frame; 64 calls in flight per connection; 20 calls per second with a burst
  of 60. Over a limit, the call fails with `protocol.busy` or `protocol.too_large`.
- Failed sign-ins and pairings count per source address (the first `X-Forwarded-For` address for a
  proxy on this machine) and per credential: one that fails 10 times within a minute is refused
  for 5 minutes, a sign-in with `bye protocol.busy` and `POST /pair` with 429 `protocol.busy`. Each
  failure is logged with its error code and the connection's id, never the credential or a
  pairing code. Each lockout sends the owner `notice.signInsLocked`
  ([spec 4, section 4](cards-and-messages.md#section-4)), naming the address, the local connection,
  or the device's or token's label, never a secret; one per lockout, and at most one per 15 minutes
  for each address or credential.

<a id="section-2-1"></a>

### 2.1 HTTP endpoints

| Method and path        | What it does                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /`                | The console (static files)                                                                                                                                                                                                                                                                                               |
| `GET /mini`            | The same console build in Mini App mode                                                                                                                                                                                                                                                                                  |
| `GET /ws`              | WebSocket upgrade                                                                                                                                                                                                                                                                                                        |
| `POST /pair`           | Device pairing (section 4.2)                                                                                                                                                                                                                                                                                             |
| `GET /file/:ticket`    | A single-use download (exports, reports, backups), valid 5 minutes                                                                                                                                                                                                                                                       |
| `POST /upload/:ticket` | A single-use upload of one image (raw body, at most 5 MiB, the size and type `upload/start` named), valid 2 minutes, held for the credential that asked for it; answers `201 { upload }`, an upload id the engine keeps in memory for 1 hour ([decisions 0227](../DECISIONS.md#d0227) and [0229](../DECISIONS.md#d0229)) |
| `GET /health`          | `200 {"state":"ready"}`, `200 {"state":"locked"}` or `503 {"state":"starting"}`                                                                                                                                                                                                                                          |

Browser requests to `/ws` and `/pair` must carry an `Origin` from the allowed list:
`http://127.0.0.1:<port>`, `http://localhost:<port>` and the Tailscale `serve` origin from config
(`engine.extraOrigins`). The origin of `remote.publicUrl` opens `/ws`, the console's files and
`POST /upload/:ticket` only: pairing links always name `127.0.0.1`, so a request through the public
address (its `Host`, `X-Forwarded-Host` or `Origin` names that host) gets 404 at `/pair` and
`/health`. Through the public address an upload must carry the public origin (else 403
`auth.origin`), and its ticket must be one a Mini App connection asked for while a connection signed
in with that Mini App's credential is still open (else 404 `image.not_found`, as for an unknown
ticket) ([decision 0229](../DECISIONS.md#d0229)). On this machine an upload comes from no browser or
an origin of the allowed list. Any other origin fails with `auth.origin`.

<a id="section-2-2"></a>

### 2.2 The webhook listener

Inbound webhooks ([decision 0053](../DECISIONS.md#d0053)) use a separate listener, `127.0.0.1:7457`
by default, which Tailscale `funnel` publishes. It serves one route and nothing else:

- `POST /hook/:ruleId/:secret` with a body of at most 16 KiB, JSON or plain text
  ([decision 0333](../DECISIONS.md#d0333)); the body is stored with the alert.
- `202` when the alert is accepted, `404` for an unknown rule or wrong secret (the same answer for
  both), `409` for a repeat, `429` above the rule's rate.
- A repeat is the same `id` field in the body, or the same body hash, within 10 minutes. `id` is
  read only from a JSON object, and only as a string of 1 to 128 characters; nothing else in the
  body is read: the rule's bounds decide every fill ([decision 0299](../DECISIONS.md#d0299)).
- A rule's rate is the alerts it accepts in any 60 seconds, its `ratePerMinute`.
- The secret is 32 random bytes in base64url; only its SHA-256 is stored.
- A rule's URL answers only while the rule is `active`: before its card's Confirm, and after it is
  deleted or rotated, the old URL gets the same `404`.
- Per [decision 0333](../DECISIONS.md#d0333): every other method, path and WebSocket upgrade,
  and a rule id or secret of the wrong form, gets that same empty `404` from its request line,
  before any body, so none of the engine's routes is served there. The secret's SHA-256 is
  compared in constant time with the rule's, or with a decoy's for an unknown rule, after the same
  read. The body is read whole first: over 16 KiB is `413`. Only accepted alerts count as repeats
  and toward the rate. Past ten times its rate of refused alerts in a minute, a rule's alerts get
  `429` with no row, and past 50 rule reads a second a request gets the `404` with no read. An
  accepted alert is in the inbox, with its body, before the `202`; one not confirmed stored within
  10 seconds is `503` and may still be stored. No answer has a body, and every answer closes its
  connection. When another listener holds `engine.webhookPort`, the engine runs without the
  listener, logs `webhook.listen_failed` and sends the owner `notice.webhookPortTaken`.

<a id="section-3"></a>

## 3. Frames

Every frame is a JSON object whose `t` field names its type.

| `t`         | Direction       | Shape                                                                                             |
| ----------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `open`      | client → engine | `{ t, v, client: { kind, version, locale? }, auth, resume? }`                                     |
| `challenge` | engine → client | `{ t, nonce, connection }` (device auth only)                                                     |
| `prove`     | client → engine | `{ t, signature }` (device auth only)                                                             |
| `ready`     | engine → client | `{ t, v, connection, scopes, engine: { version, protocol, state }, owner: { locale, timezone } }` |
| `call`      | client → engine | `{ t, id, op, args, key? }`                                                                       |
| `reply`     | engine → client | `{ t, id, result }`                                                                               |
| `fail`      | engine → client | `{ t, id, error: { code, message, retryable, details? } }`                                        |
| `push`      | engine → client | `{ t, topic, seq, kind, data }`                                                                   |
| `bye`       | engine → client | `{ t, code, message }`, then the engine closes the socket                                         |

- `open` is the first frame. Anything else first ends the connection with `bye protocol.not_open`.
  `open` must arrive within 10 seconds.
- `v` is the protocol version (section 9).
- `client.kind` is `runtime`, `console`, `mini`, `cli`, `tui` or `mcp`.
- `id` in `call` is chosen by the client, unique per connection, at most 64 characters.
- Replies can arrive out of order; the client matches them by `id`.
- `state` in `ready` is `starting`, `ready` or `locked`. While starting, every operation except
  `engine/status` fails with `engine.starting` (retryable); a `push` on topic `engine` announces
  readiness. `locked` serves every call, but the engine has no agent key and signs nothing until
  `engine/unlock` opens it ([decision 0103](../DECISIONS.md#d0103)); a `push` on topic `engine`
  announces the unlock.

<a id="section-4"></a>

## 4. Authentication and scopes

<a id="section-4-1"></a>

### 4.1 Scopes

| Scope     | Allows                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `read`    | Reading everything except secrets                                                                                                       |
| `propose` | Creating intents, auto orders, alerts and schedules; cancelling the client's own pending intents and its orders                         |
| `chat`    | The owner's side of chat: sending messages, stopping or clearing a turn                                                                 |
| `agent`   | The agent's side of chat: receiving the owner's messages, posting replies and usage                                                     |
| `confirm` | Confirming or denying cards; braking: freeze, cancel, rescue, stricter limits and send levels, manual mode, revoking devices and tokens |
| `loosen`  | Looser limits and send levels (under the ceiling), unfreeze, auto mode ([decision 0089](../DECISIONS.md#d0089))                         |
| `admin`   | Settings, looser limits and send levels, unfreeze, wallets, plugins, skills, tokens, backups, updates                                   |

| Client             | Transport | Scopes                                                                       |
| ------------------ | --------- | ---------------------------------------------------------------------------- |
| CLI, terminal chat | IPC       | `read`, `propose`, `chat`, `confirm`, `loosen`, `admin`                      |
| Agent runtime      | IPC       | `read`, `propose`, `agent`                                                   |
| `binference mcp`   | IPC       | `read`, `propose`                                                            |
| Console device     | WS        | `read`, `propose`, `chat`, `confirm`, `loosen`, `admin`                      |
| Telegram Mini App  | WS        | `read`, `chat`, `confirm`, `loosen` ([decision 0089](../DECISIONS.md#d0089)) |

A Telegram tap is handled inside the engine and never travels over this protocol.

<a id="section-4-2"></a>

### 4.2 Credentials

- **Tokens (IPC only).** 32 random bytes in base64url with the prefix `bnt_`; only the SHA-256 is
  stored, with its scopes, label and last use. The CLI's token is created by `binference init` in
  `~/.binference/auth/cli.token`, owner-only. The runtime receives its token on stdin when the
  engine starts it. `binference mcp --client <client>` reads `auth/mcp-<client>.token`, and
  `binference mcp` alone `auth/mcp.token`, each with `read` and `propose` only.
  `binference mcp setup` makes a client's token in the CLI and registers only its SHA-256 with
  `token/register` ([decision 0154](../DECISIONS.md#d0154)). `open.auth` is `{ token }`. A token
  can have an expiry: from then on its sign-in fails with `auth.expired`, and a connection signed
  in with it ends with `bye auth.expired` ([decision 0159](../DECISIONS.md#d0159)).
- **Console devices (WS only).**
  1. `binference console` prints a link `http://127.0.0.1:7456/#pair=<code>` from `device/pair`; the
     code is single-use and valid 10 minutes ([decision 0155](../DECISIONS.md#d0155)).
  2. The browser makes an Ed25519 key pair with WebCrypto, marked non-extractable (ECDSA P-256 where
     Ed25519 is missing), and sends `POST /pair` with `{ code, publicKey, alg, label }`. The engine
     answers `201 { deviceId }`, and raises `notice.newDevice`. It refuses a bad origin with 403
     `auth.origin`, a malformed body or key with 400 `protocol.bad_args` before it uses the code, an
     unknown or used code with 401 `auth.invalid`, and an expired one with 401 `auth.expired`; the
     body of a refusal is `{ error: { code, message } }`.
  3. Each connection sends `open` with `auth: { device: deviceId }`. The engine answers `challenge`
     with 32 random bytes and the connection's id; the browser signs
     `"binference-device-v2\n" + connection + "\n" + deviceId + "\n" + nonce + "\n" + origin` and
     sends `prove`, so a proof holds for one connection of one device on one origin.
- **Telegram Mini App (WS only).** `open.auth` is `{ telegram: { initData, ticket } }`. The engine
  checks Telegram's signature with the owner's bot token, requires an `auth_date` at most 5
  minutes before the engine's time and at most 1 minute after it
  ([decision 0166](../DECISIONS.md#d0166)) and the owner's numeric user id, and refuses an
  `initData` hash it has seen in the last 24 hours, kept in `engine.sqlite` across restarts. Which
  code each refusal gets, how it keeps the hashes, and how a new owner ends the old one's Mini App
  are in [decision 0160](../DECISIONS.md#d0160). `ticket` is the single-use launch ticket `/console` put
  in the button's fragment (`/mini#ticket=<ticket>`): 32 random bytes in base64url, kept only as a
  hash, valid 5 minutes, for the owner who sent `/console`. The engine spends it in the write that
  claims the launch; a launch without a live ticket ends with `bye auth.invalid`, or
  `bye auth.expired` for an expired one. A Mini App connection ends with `bye auth.expired` 12
  hours after it signed in ([decision 0161](../DECISIONS.md#d0161)).
- A revoke of a token or device, or a new Telegram owner, ends every connection signed in with
  the credential, and every one still signing in with it: the sign-in reads the credential back
  from its last write to `engine.sqlite` and refuses a revoked one with `auth.revoked`, and a
  revoke stored after that write finds the connection by the credential its `open` claimed.
- A failed `open` ends with `bye` and one of `auth.required`, `auth.invalid`, `auth.expired`,
  `auth.origin` or `auth.revoked`. A call above the connection's scopes fails with `auth.scope`; a
  local-only call over WS fails with `auth.local_only`.

<a id="section-5"></a>

## 5. Writes and idempotency

- Every operation marked `write` in section 7 needs `key`: a client-made string of at most 64
  characters, unique per intended action (a UUIDv7 works).
- The engine stores `(credential, op, key)` with a hash of `args` and the result for 24 hours. The
  same key with the same args returns the stored result; the same key with different args fails with
  `protocol.key_reused`. The hash leaves out a passphrase (`engine/unlock`), so the store holds no
  trace of it. The result of `webhookRule/create` and `webhookRule/rotateUrl` is stored without its
  URL, which ends in the rule's secret, and the same key fails `webhook.url_shown` from then on:
  the URL is shown once ([decision 0337](../DECISIONS.md#d0337)).
- A write is stored durably before its `reply` is sent.

<a id="section-6"></a>

## 6. Pushes

- A client subscribes with `push/subscribe` `{ topics: { [topic]: fromSeq? } }`. Each topic has its
  own `seq`, starting at 1 and rising by 1.
- The engine keeps the last 1,000 pushes or 10 minutes per topic, whichever is less. When `fromSeq`
  is older, the reply carries `resync: [topic]`: the client refetches with the topic's list
  operation, then subscribes from the current `seq`.
- A client that sees a gap in `seq` does the same.
- A client receives only topics its scopes allow.

| Topic           | Scope   | Kinds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine`        | `read`  | `engine/state`, `engine/updateAvailable`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `intent`        | `read`  | `intent/created`, `intent/changed`, `card/opened`, `card/closed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `order`         | `read`  | `order/created`, `order/changed`, `order/filled`, `order/skipped`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `portfolio`     | `read`  | `portfolio/changed` (at most once per second per agent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ledger`        | `read`  | `ledger/appended`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `alert`         | `read`  | `alert/fired` (an `AlertFired`, section 8.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `notice`        | `read`  | `notice/new`: the owner notifications of [ARCHITECTURE.md section 27](../ARCHITECTURE.md#section-27), as an i18n key and its values, with the times (epoch milliseconds), amounts (base units) and parts (messages its message takes as arguments, `{ key, values, times?, amounts?, parts? }`, two levels deep at most) among them for each surface to format, the messages that follow it on lines of their own (`after`), and the notice's `id` and `at`; `notice/list` reads on from the last `id` ([decision 0133](../DECISIONS.md#d0133))                                                                                                                                                                                                                                                                                                                               |
| `launch`        | `read`  | `launch/new`: a `LaunchView` (section 8.3) for each token a launchpad created, once, in block order; `launch/list` reads on from a time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `chat:<agt_id>` | `read`  | `chat/message`, `chat/status`, `chat/progress` (from `turn/progress`, shown only while its turn runs), `chat/reasoning` (from `turn/reasoning`), `chat/deposit` (from `turn/deposit`: `{ agent, turn, mode, frozen, wallets }`), `chat/chart` (from `turn/chart`: `{ agent, turn, chart }`), `chat/images` (from `image/made` and `image/show`: `{ agent, turn, prompt, images }`, each `{ image, contentType, bytes, path }`), `chat/files` (from `file/send`: `{ agent, turn, caption, files }`, each `{ file, name, bytes, path }`), `chat/credentialRequest` (a `CredentialRequestView`) and `chat/credentialRequestClosed` (`{ agent, request, outcome }`), `chat/turnStarted`, `chat/turnEnded`, `chat/question` (a `QuestionView`, section 7.7), `chat/questionClosed` (`{ question, state, answer? }`), `chat/launchDraft` and `chat/launchDraftClosed` (section 7.7) |
| `inbox`         | `agent` | `inbox/message`, `inbox/intentSettled`, `inbox/orderSettled`, `inbox/scheduleDue`, `inbox/alertFired`, `inbox/resumeReport`, `inbox/stop`, `inbox/clear`; each is a stored message, with the data of [spec 8, section 3.3](runtime.md#section-3-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `config`        | `read`  | `config/changed` (a config journal entry)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `job`           | `read`  | `job/progress`, `job/done`, `job/failed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `log`           | `admin` | `log/line` (after `log/follow`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

<a id="section-7"></a>

## 7. Operations

Operation names are `domain/action`: a singular domain, then a camelCase action. Columns: **scope**;
**write** (needs `key`); **local** (IPC only). Routed operations (marked R) are answered by the
agent runtime through the engine; when the runtime is down they fail with `runtime.unavailable`.

Long operations return `{ job }` at once and report through the `job` topic. A job ends with one
push: `job/done` `{ job, op, result }`, whose `result` has the shape the operation's row names, or
`job/failed` `{ job, op, error }`, whose `error` is an error of section 10. A client subscribes to
`job` before it calls, so it never misses the end. The topic has no list operation: a client that
must refetch reads the operation's own list, such as `backup/list`. File results are
`{ url, expiresAt }` for `GET /file/:ticket`.

<a id="section-7-1"></a>

### 7.1 Engine and safety

| Operation                   | Scope     | Write | Local | Args → result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | --------- | ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/status`             | `read`    |       |       | → `{ state, version, protocol, frozen, agents: [{ id, mode, frozen, launchWallet?, bridgeWallet?, autoAsks? }], health: [{ signal, state, since?, lagBlocks?, unpricedTokens? }], debugSignalOff? }`; an agent's `autoAsks` is `plugin` while it is in auto mode and a community plugin is on ([decision 0350](../DECISIONS.md#d0350)); `debugSignalOff` says whether the engine's Node runs with `--disable-sigusr1`, which community plugins need ([decision 0343](../DECISIONS.md#d0343)); `since` is when a signal that is not `ok` stopped being ok, such as when the agent runtime went down; the `rpc` signal is `fail` while every endpoint of a chain's reads rests after a failure, and `warn` while some do or while the chain's log endpoints rest ([decision 0272](../DECISIONS.md#d0272)); `lagBlocks` is how many blocks the `watcher` signal's price reads trail the chain ([decision 0193](../DECISIONS.md#d0193)); `unpricedTokens` is how many watched tokens have had no confirmed price for a minute, or no decimals read to price a whole token by, which makes the signal at least `warn` ([decisions 0194](../DECISIONS.md#d0194) and [0197](../DECISIONS.md#d0197)) |
| `engine/describe`           | `read`    |       |       | → every operation with its scope, flags, `since` and JSON Schemas of args and result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `engine/stop`               | `admin`   | ✓     | ✓     | → `{}`; graceful shutdown ([ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `engine/unlock`             | `admin`   | ✓     | ✓     | `{ passphrase? }` → `{}`; opens the agent key ([decision 0104](../DECISIONS.md#d0104))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `safety/status`             | `read`    |       |       | → `{ frozen, frozenAt?, agents?, rescue?, rescueAddress?, pendingRescueAddress?, pendingRescueAt? }`: whether the install or any agent is frozen, when the whole install was, each frozen agent `{ agent, frozenAt }`, the rescue that has not ended `{ intent, state }`, the rescue address in effect, and a new one with when it takes effect ([decision 0128](../DECISIONS.md#d0128))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `safety/freeze`             | `confirm` | ✓     |       | `{ agent?: agt_ }` (absent: the whole install, and every agent created until an unfreeze, [decision 0128](../DECISIONS.md#d0128)) → `{ frozenAt }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `safety/unfreeze`           | `loosen`  | ✓     |       | `{ agent?: agt_ }` → `{ intent? }`: an `unfreeze` intent awaiting the owner's tap from any surface, none when nothing is frozen ([rule 11](../ARCHITECTURE.md#rule-11), [decision 0128](../DECISIONS.md#d0128))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `safety/rescue`             | `confirm` | ✓     |       | `{}` → `{ intent }`: one rescue intent for every agent wallet, awaiting a tap; while one has not ended, that one ([decision 0125](../DECISIONS.md#d0125)); fails `rescue.no_address` or `rescue.nothing_to_move`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `safety/setRescueAddress`   | `admin`   | ✓     | ✓     | `{ address: AccountRef, ownerKey }` → `{ effectiveAt }` (24 hours later, [decision 0044](../DECISIONS.md#d0044)); saved in every ceiling with the owner key ([decision 0110](../DECISIONS.md#d0110)); a launch wallet of the install is `address.launch_wallet` ([decision 0218](../DECISIONS.md#d0218)), a bridge wallet `address.bridge_wallet` and a contract the registry lists for a venue `address.venue_contract` ([decision 0307](../DECISIONS.md#d0307))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `safety/cancelRescueChange` | `confirm` | ✓     |       | `{}` → `{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `notice/list`               | `read`    |       |       | paging → notices, in the order they were recorded, each with `id`, `at`, `key`, `agent?`, `intent?`, `values`, `times?`, `amounts?`, `parts?`, `after?`, `assets?` (each unlisted token an amount names, as its order's card stored it, [decision 0199](../DECISIONS.md#d0199)) and `delivered` (each surface's `queued`, `sent`, `unknown_after_send` or `failed`; none for a notice the owner muted); the cursor is a notice's `id`, and the page holds the notices recorded after it ([decision 0133](../DECISIONS.md#d0133))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `notice/getSettings`        | `read`    |       |       | `{ agent }` → `{ muted, mutable, dailySummaryTime }`: the notice kinds the agent muted, the kinds it may mute, and its daily summary's time, `HH:mm` in the owner's timezone ([decision 0185](../DECISIONS.md#d0185))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `notice/setSettings`        | `admin`   | ✓     |       | `{ agent, muted?, dailySummaryTime? }` → as `notice/getSettings`: `muted` replaces the kinds muted; a kind that cannot be muted, one named twice or a time not `HH:mm` is `protocol.bad_args`; journaled under `agents.<name>.notifications` ([decision 0185](../DECISIONS.md#d0185))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `telegram/pair`             | `admin`   |       | ✓     | → `{ link, expiresAt }`: a new single-use start code for the owner's bot, valid 10 minutes, its link shown once; whoever opens it first becomes the owner in place of the current one, who is told in their chat; a read, so the code is never stored but as its hash ([decision 0139](../DECISIONS.md#d0139)); fails `telegram.not_running` without the bot, `telegram.unreachable` when Telegram does not answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

<a id="section-7-2"></a>

### 7.2 Agents and wallets

| Operation             | Scope                                       | Write | Local | Args → result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent/list`          | `read`                                      |       |       | paging → agents, archived ones too, oldest first, each `AgentView` with its `defaultWallet`: the oldest wallet not archived that is no launch wallet, a `WalletView`, which a proposal uses when it names none, its live `launchWallet` ([decision 0217](../DECISIONS.md#d0217)) and its live `bridgeWallet` ([decision 0307](../DECISIONS.md#d0307))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `agent/get`           | `read`                                      |       |       | `{ agent }` → `AgentView`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `agent/create`        | `admin`                                     | ✓     |       | `{ name, locale? }` → `AgentView` (starts in paper mode with the defaults table)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `agent/rename`        | `admin`                                     | ✓     |       | `{ agent, name }` → `AgentView`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `agent/archive`       | `admin`                                     | ✓     |       | `{ agent }` → `{}` (orders cancelled, funds untouched)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `agent/goLive`        | `admin`                                     | ✓     | ✓     | `{ agent, disclaimer? }` → `AgentView`; fails `agent.disclaimer` until the owner accepted the current disclaimer, which `disclaimer` carries as the version the owner typed the phrase for at the caller and the engine then stores ([decision 0220](../DECISIONS.md#d0220)), and `wallet.unfunded` when not ready, and `limit.needs_launch_wallet` while its venues hold one that trades on a launch's own contracts or only launches tokens ([decision 0282](../DECISIONS.md#d0282)) and it has no live launch wallet, `limit.over_ceiling` while that wallet's ceiling lacks one of the venue's launch calls ([decision 0218](../DECISIONS.md#d0218)), and `limit.needs_bridge_wallet` while its venues hold one only a bridge wallet uses and it has no live bridge wallet ([decision 0307](../DECISIONS.md#d0307))                                      |
| `agent/goPaper`       | `confirm`                                   | ✓     |       | `{ agent }` → `AgentView` (braking)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `agent/readFile`      | `read`                                      |       |       | `{ agent, file }` → `{ text, updatedAt }`; `file` is one of the workspace files; `agent.file_missing` for a file the agent does not have ([decision 0200](../DECISIONS.md#d0200))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `agent/writeFile`     | `admin`                                     | ✓     |       | `{ agent, file, text }` → `{ updatedAt }`: replaces the file whole; the agent's next turn reads it; `agent.archived` for an archived agent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `agent/editFile`      | `agent`                                     | ✓     |       | `{ agent, file, text }` → `{ updatedAt }`: the agent replaces `STRATEGY.md` or `PERSONA.md` whole, at most 12,000 characters, only from a running turn of the runtime whose context holds no outside content, else `agent.file_untrusted` ([decision 0242](../DECISIONS.md#d0242))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `agent/endFirstChat`  | `agent`                                     | ✓     |       | `{ agent }` → `{}`: removes `FIRST-CHAT.md` and ends the first chat; `agent.file_missing` once it is gone ([decision 0242](../DECISIONS.md#d0242))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `facts/get`           | `read`                                      |       |       | `{ agent }` → `LiveFactsView`: what the agent stands on now, which the runtime puts after the history of each model call; balances are left out when they cannot be read now ([decision 0201](../DECISIONS.md#d0201))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `wallet/list`         | `read`                                      |       |       | `{ agent? }` → wallets with addresses and labels, `extra` on an extra launch or bridge wallet, and `missingCalls` on the agent's launch or bridge wallet: the functions its ceiling lacks that only a wallet of its role makes on the agent's venues, such as a create call ([decisions 0271](../DECISIONS.md#d0271) and [0307](../DECISIONS.md#d0307))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `wallet/create`       | `admin`                                     | ✓     | ✓     | `{ agent, label, ownerKey, launch?, bridge? }` → `WalletView` (a new Privy wallet, spec 5); with `launch: true` the agent's launch wallet, `role: "launch"` ([decision 0217](../DECISIONS.md#d0217)), `wallet.launch_exists` when it has a live one, and `wallet.no_launch_calls` when no launchpad the install runs declares a launch call or a call only a launch wallet makes ([decisions 0218](../DECISIONS.md#d0218) and [0271](../DECISIONS.md#d0271)); with `bridge: true` the agent's bridge wallet, `bridge: true`, `wallet.bridge_exists` and `wallet.no_bridge_calls` likewise ([decision 0307](../DECISIONS.md#d0307)); both at once `protocol.bad_args`; calls run one at a time                                                                                                                                                                |
| `wallet/rename`       | `admin`                                     | ✓     |       | `{ wallet, label }` → `WalletView`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `wallet/exportKey`    | `admin`                                     | ✓     | ✓     | `{ wallet, ownerKey }` → `{ privateKey }`; unserved since [decision 0131](../DECISIONS.md#d0131)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `wallet/exportSealed` | `admin`                                     |       | ✓     | `{ wallet, recipientPublicKey, ownerKey }` → `{ ciphertext, encapsulatedKey }`: the key sealed with HPKE to a key only the CLI holds; a read, never stored ([decision 0131](../DECISIONS.md#d0131))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ceiling/get`         | `read`                                      |       |       | `{ wallet }` → the wallet's Privy policy as `CeilingView`, with each 24-hour cap: its asset, size, window and dollars at the floor price ([decision 0149](../DECISIONS.md#d0149)), and a launch wallet's `launchCalls`, the functions it may call on any contract ([decision 0218](../DECISIONS.md#d0218))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ceiling/set`         | `admin`                                     | ✓     | ✓     | `{ wallet, changes, ownerKey }` → `CeilingView`: venues and the per-transaction cap of every live wallet of the wallet's agent; fails `limit.venue_in_use` ([decision 0132](../DECISIONS.md#d0132)), and `wallet.ceiling_too_large`, `wallet.ceiling_bad_bridge` or `wallet.ceiling_uncapped` before any wallet changes ([decision 0302](../DECISIONS.md#d0302)); a bridge wallet keeps every bridge venue's deposits whatever venues `changes` names, and `wallet.no_bridge_calls` refuses a change that leaves it none ([decision 0307](../DECISIONS.md#d0307)); `changes.dayCapUsdMicros`, alone, resizes the 24-hour caps of every live wallet of the install ([decision 0151](../DECISIONS.md#d0151)); a change that moves the contracts, the functions or the cap a ceiling allows is journaled and announced ([decision 0271](../DECISIONS.md#d0271)) |
| `signer/revoke`       | `admin`                                     | ✓     | ✓     | `{ signer, ownerKey }` → `{}`: removes a machine's agent key from every live wallet; fails `signer.own_key`, `signer.not_found`, `signer.last_signer` or `signer.change_expired` ([decision 0140](../DECISIONS.md#d0140))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `approval/get`        | `read`                                      |       |       | `{ agent }` → `{ mode, changedAt, autoAsks? }` ([decision 0088](../DECISIONS.md#d0088)); `autoAsks` is `plugin` in auto mode while a community plugin is on, so every proposal asks ([decision 0350](../DECISIONS.md#d0350))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `approval/set`        | `confirm` for `manual`, `loosen` for `auto` | ✓     |       | `{ agent, mode }` → `{ mode, changedAt, autoAsks? }`, `autoAsks` as in `approval/get`; announced on every surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Workspace files: `RULES.md`, `PERSONA.md`, `OWNER.md`, `STRATEGY.md`, `NOTES.md`, `FIRST-CHAT.md`. The engine makes them from their templates in the owner's language when it makes an agent, and keeps them in `workspace/<agent>/` ([decision 0200](../DECISIONS.md#d0200)).

<a id="section-7-3"></a>

### 7.3 Market reads

| Operation              | Scope            | Args → result                                                                                                                                                   |
| ---------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portfolio/get`        | `read`           | `{ agent?, wallet? }` → balances, USD values, positions, P&L, paper flag; live before paper, each with its own total, never summed                              |
| `portfolio/pnl`        | `read`           | `{ agent, from, to, cards? }` → P&L by position, live and paper apart ([decision 0137](../DECISIONS.md#d0137)); P&L cards (below)                               |
| `portfolio/resetPaper` | `confirm`, write | `{ agent, balances? }` → the new paper portfolio (default 1 BNB and 500 USDT)                                                                                   |
| `asset/get`            | `read`           | `{ asset }` → `AssetInfo` with risk when known                                                                                                                  |
| `asset/search`         | `read`           | `{ chain, query, agent? }` → `{ items, unlisted?, ambiguous? }`: matches from the registry and the held tokens only (below)                                     |
| `name/resolve`         | `read`           | `{ name }` → `{ name, address, resolvedAt, smartAccount?, reverse? }` (`.bnb`, [decision 0071](../DECISIONS.md#d0071)); below                                   |
| `quote/get`            | `read`           | a swap request (section 8.1) → `QuoteView`; creates no intent                                                                                                   |
| `risk/check`           | `read`           | `{ asset, agent? }` → `RiskView`: the risk step on a sample buy for the agent, the oldest one when left out ([decision 0379](../DECISIONS.md#d0379))            |
| `market/scan`          | `read`           | `{ chain, source: launches \| trending, filters?: LaunchFilter, limit? }` → `{ items: [ScanItem], assets }` (below)                                             |
| `market/chart`         | `read`           | `{ asset, interval: 1m \| 5m \| 15m \| 1h \| 4h \| 1d, to?, limit? }` → `{ asset, interval, candles, priceScale?, source }` (below)                             |
| `wallet/activity`      | `read`           | paging, `{ agent, account: AccountRef, from?, to? }` → `{ items: [ActivityItem], next?, assets }` of a tracked wallet (below)                                   |
| `launch/list`          | `read`           | paging, `{ chain, from?, filters?: LaunchFilter }` → `LaunchView` items, newest first, launched at or after `from`                                              |
| `launchpad/list`       | `read`           | `{ chain }` → `{ items: [LaunchpadView] }`: each launchpad the engine runs on the chain, where it takes the picture, its settings                               |
| `staking/options`      | `read`           | `{ chain, agent?, venue? }` → `{ items: [StakingOptionView], positions?: [StakingPositionView], assets }` (below)                                               |
| `bridge/quote`         | `read`           | `{ agent, wallet?, amount: Amount, toChain: ChainRef, to?: { entry } \| { rescue: true } }` → `{ items: [BridgeRouteView], assets }`; creates no intent (below) |

- `asset/search` reads the chain registry and the positions store, never the web. A query the
  chain's family reads as an address names that token: `items` holds it with the registry's
  `AssetInfo` when the registry lists it, else `unlisted` holds its canonical id and `held`,
  whether a wallet of `agent` (of every agent when absent) holds some of it, live or on paper. Other
  text matches the registry's symbols whole, in any case, the chain's coin among them; only when
  none does, the names that hold the text. Every match is on one page, and `ambiguous` is `true`
  when more than one matched, so the client asks the owner which one they mean.
- `portfolio/pnl` sums what each execution recorded from `from` to `to`, both included, realized
  when it was recorded at average cost ([decision 0058](../DECISIONS.md#d0058)), counted for the
  asset it sold. The unrealized P&L is today's, of what the positions hold now, whatever the range.
  Live and paper stay apart (`PnlView`, section 8.3), and every wallet the agent had counts,
  archived ones too ([decision 0137](../DECISIONS.md#d0137)).
  With `cards: true` it also answers `cards`, `PnlCardView` items the engine draws as card lines
  (spec 4, section 3.7): one per position of the agent open now, and per position a sale emptied
  from `from` to `to`; live before paper, each mode's open positions first by value, then its
  closed ones, the latest first. Each card covers its position's whole span, whatever the range
  ([decision 0243](../DECISIONS.md#d0243)).
- `market/scan` with `source: launches` reads the engine's own launch records (`launch/list`),
  newest first, from the last 24 hours; while the engine runs no launch feed it fails
  `market.no_launch_feed`. With `trending`, it reads the market data source's trending tokens on
  the chain (DEX Screener's most boosted tokens in v1, each with its active boosts,
  [decision 0182](../adr/0182-market-reads-use-dex-screener-s-documented-api-and-mark-paid-rank.md)),
  in its order; `filters` describe launches, so with `trending` they fail `protocol.bad_args`.
  `limit` is 20 by default and at most 50. A `ScanItem` is
  `{ asset, launchpad?, launchedAt?, priceUsdMicros?, priceScale?, liquidityUsdMicros?, volume24hUsdMicros?, change24hBps?, curveProgressBps?, graduated?, activeBoosts?, risk?: RiskView }`;
  fields the source does not give are absent. `activeBoosts` counts the boosts bought for the
  token that are active now. `risk` is present only when the risk cache holds a fresh answer: a
  scan never calls a risk source.
- `launch/list` reads the engine's own launch records
  ([decision 0256](../DECISIONS.md#d0256)), newest first by time, block and log index, a page at
  a time; `next` names the last launch's time, block and log index. Its `filters` name only
  launchpads the engine runs and quote tokens the registry holds, else `protocol.bad_args`; a
  `minLiquidityUsdMicros` passes no launch, since the feed reads no liquidity. Each `LaunchView`
  carries `assets`: its token's info as its creator wrote it, unverified unless the registry lists
  the token, and its quote token's ([decision 0255](../DECISIONS.md#d0255)).
- `launchpad/list` answers each launchpad the engine runs on the chain, in the order its venues
  came, as a `LaunchpadView` `{ venue, picture: { place, mostBytes?, mostSide? }, settings }`. Its
  `picture.place` says what a `launchToken` on it names as `image`: `upload`, an upload id of the
  proposer's own, at most `mostBytes` (5 MiB); `create_call`, an upload id of a small picture the
  create call writes, at most `mostBytes` beside a launch with no description or links (longer
  words leave fewer) and `mostSide` pixels each way; `link`, the literal `none`, with the picture
  as the launchpad's `link` setting. `settings` holds each setting it declares, as `venueOptions`
  takes it: `{ name, type, choices?, min?, max?, default?, optional?, workedOut?, outsideOnly? }`;
  one with neither `default` nor `optional` must be given, and a `workedOut` one never is. A
  surface that starts a launch reads it before it asks the owner for a picture, and asks only for
  what the engine takes ([decisions 0276](../DECISIONS.md#d0276) and
  [0279](../DECISIONS.md#d0279)). A chain the registry does not hold is `protocol.bad_args`; an
  engine whose venues launch no token answers no item.
- `market/chart` answers OHLCV candles in USD, oldest first: each
  `{ at, openUsdMicros, highUsdMicros, lowUsdMicros, closeUsdMicros, volumeUsdMicros }`, `at` the
  candle's start. They are the `limit` newest candles that start before `to`; `limit` is 100 by
  default and at most 500, and `to` defaults to now. The chart reads the token's deepest pool, in
  USD for the token itself, and an interval with no trade repeats the last close with no volume.
  `source` names where they came from (`geckoterminal` in v1,
  [decision 0183](../adr/0183-candles-come-from-a-source-that-publishes-them.md)). A source that
  answers nothing for the asset fails `market.no_data`; one that is down fails
  `market.source_down` (retryable).
- **Prices of cheap tokens** ([decision 0184](../adr/0184-market-scans-and-charts-keep-cheap-prices-readable.md)).
  The four prices of each candle and a `ScanItem`'s `priceUsdMicros` are micro-dollars for
  10^`priceScale` whole tokens, rounded down. `priceScale` is the smallest of 0 to 18 at which the
  lowest price above zero, in the chart or in the item, comes to at least one dollar, and is absent
  when 0. A chart's `priceScale` sits beside its `candles`. Volumes and liquidity stay
  micro-dollars.
- `wallet/activity` reads the trades of a wallet the agent tracks (a leader of one of its copy
  orders, or the account of one of its wallet alerts), newest first, from what the leader watcher
  recorded since tracking began. Any other account, the agent's own wallets among them, fails
  `wallet.not_found`: the engine reads no history it did not watch, and the agent reads its own
  wallets with `portfolio/get` and `intent/get` ([decision 0259](../DECISIONS.md#d0259)). An
  `ActivityItem` is
  `{ at, block, tx, side: buy | sell, asset, amount, counterAsset, counterAmount, valueUsdMicros?, shareSoldBps?, venue? }`;
  `shareSoldBps` is the share of the account's holding a sale took, as the watcher saw it.
- `name/resolve` takes a `.bnb` name, normalized as SPACE ID normalizes names before it hashes
  them; a name that does not end in `.bnb` or does not normalize is `protocol.bad_args`. The
  engine reads SPACE ID's registry and the name's resolver on BNB Smart Chain at the latest block,
  every call, and caches nothing. It answers the address record as a CAIP-10 account of BNB Smart
  Chain. `reverse` says what the address's reverse record names: `matches` (this name), `differs`
  (another name) or `none`. `smartAccount: true` marks an address whose only code is an EIP-7702
  delegation designator, a smart-account wallet, which counts as a person
  ([decision 0306](../DECISIONS.md#d0306)). It fails `name.not_found` for a name with no resolver,
  no address record, the zero address or an expired registration, its grace period included;
  `name.contract` for an address that holds any other code, since a send by name pays a person,
  never a contract; and `name.resolver_down`, retryable,
  when the chain does not answer. A send by name resolves the same way when it is proposed and again
  when its wallet's queue takes it (section 8.1, spec 6).
- `staking/options` reads each staking venue the agent's venues allow on `chain`, or `venue`
  alone, a staking venue's id (`stakehub`, `lista`). A `StakingOptionView` is
  `{ venue, validator: AccountRef, pool?: true, name, commissionBps, aprBps?, jailed, unbondingSeconds, minAmount? }`
  for each validator StakeHub lists at the latest block, and for a liquid staking venue its one
  pool, marked `pool: true` ([decision 0331](../DECISIONS.md#d0331)): on `lista`, Lista's stake
  manager, named Lista, its commission the share of rewards Lista keeps, never jailed. A staking
  request on a pool names no validator. slisBNB's rate shows as its price
  ([decision 0328](../DECISIONS.md#d0328)). `aprBps` is absent when the venue gives none. `name`
  is the validator's moniker, set by its operator: clients escape it, the card cuts it to 32
  characters, and the `staking_options` tool marks its turn ([rule 13](../ARCHITECTURE.md#rule-13)).
  With `agent`, `positions` holds the agent's staking positions in its mode, live or paper
  (section 8.3). A venue that does not answer fails `quote.venue_down`, retryable.
- `bridge/quote` reads each bridge route the chain registry lists from the wallet's chain to
  `toChain` for `amount.asset`, at each bridge venue the agent's venues allow
  ([decision 0297](../DECISIONS.md#d0297)), best `minOut` first, as `BridgeRouteView`s
  (section 8.3). `to`, when given, names the recipient the route is priced for, checked as
  section 8.1 checks a bridge's. Without it, the routes are priced for the rescue address on
  `toChain` when the agent's bridge rules joined it there or the address book saves it there, else
  the quote is `address.no_recipient`, which asks the owner which saved address to use
  ([decision 0330](../DECISIONS.md#d0330)). A `toChain` the registry lists as no destination is
  `protocol.bad_args`; no route answers `quote.no_route`, and a venue that does not answer
  `quote.venue_down`. Paper agents quote too: a quote moves nothing.
- Names and symbols in `assets` of these results are set by whoever deployed each token
  ([rule 3](../ARCHITECTURE.md#rule-3)); an agent tool that returns them marks its turn
  ([spec 8, section 5.4](runtime.md#section-5-4)).

<a id="section-7-4"></a>

### 7.4 Intents

| Operation        | Scope                                                                   | Write | Args → result                                                                             |
| ---------------- | ----------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `intent/propose` | `propose`                                                               | ✓     | `IntentRequest` (section 8.1) → `IntentView`                                              |
| `intent/get`     | `read`                                                                  |       | `{ intent }` → `IntentView`                                                               |
| `intent/card`    | `read`                                                                  |       | `{ intent }` → `CardLinesView`: the open card's lines and version, as Telegram draws them |
| `intent/list`    | `read`                                                                  |       | paging, `{ agent?, state?, kind? }` → intents                                             |
| `intent/confirm` | `confirm`                                                               | ✓     | `{ intent, card, cardVersion }` → `IntentView`                                            |
| `intent/deny`    | `confirm`                                                               | ✓     | `{ intent, card }` → `IntentView`                                                         |
| `intent/cancel`  | `confirm`, or `propose` for the client's own intent before confirmation | ✓     | `{ intent }` → `IntentView`                                                               |

- `intent/propose` always answers with an intent when the args are valid. A refusal by policy or
  risk is an intent in a terminal state (`rejected_policy`, `risk_blocked`) with its reason, not a
  `fail`. This follows [ENGINEERING.md section 7](../ENGINEERING.md#section-7): expected outcomes
  are results.
- A `swap`, `buy` or `sell` that names a token the registry does not list reads its symbol, name
  and decimals on chain before anything is stored; the intent keeps them, marked unverified, and
  its cards, receipts and views show the token by them. A token that answers no symbol or no
  decimals fails with `asset.unreadable` and stores nothing
  ([decision 0199](../DECISIONS.md#d0199)). A `stake` that stakes or unstakes does the same for the
  receipt token its venue names for the validator, such as a StakeHub validator's credit shares,
  so its receipt and positions name what it minted or burned.
- A request, or an `order/create`, that names the agent's bridge wallet fails with
  `intent.bridge_wallet_only`, and one that names an extra launch or bridge wallet with
  `intent.extra_wallet`; nothing is stored ([decision 0307](../DECISIONS.md#d0307)).
- A `launchToken` answers once it waits in `quoted` for its launchpad's pin, or has passed it to
  its card, or ended; its card reaches the owner with `card/opened`. A `venue` that launches no
  token on the pair's chain fails with `quote.no_route`, and `venueOptions` its launchpad does not
  declare, values that do not fit them, or settings the launchpad does not take together, with
  `protocol.bad_args`; neither stores anything. A setting the launchpad declares optional may be
  left out: the launchpad's quote may then work out its value, which the card shows like any
  other, and an `amount` setting is base units of `pairWith` as a decimal string
  ([decision 0280](../DECISIONS.md#d0280)). Its
  `image` is an upload id from `upload/start` ([decision 0234](../DECISIONS.md#d0234)). A
  launchpad with no API for pictures takes the picture as a `link` setting in `venueOptions`, an
  `ipfs://` or `https://` address of at most 512 bytes the owner hosts, which nothing opens. It
  reads no upload: its launch's `image` is the literal `none` (`noUploadImage`), which this version
  keeps required, and any other `image` fails with `protocol.bad_args`, so no picture is dropped
  unseen; `none` on a launchpad that uploads fails the same way. Both store nothing
  ([decision 0276](../DECISIONS.md#d0276)). A launchpad that writes the picture into its create
  call reads the upload `image` names, which must tell its width and height and fit beside the
  launch's words, else the launch ends `failed_check` with `image_unreadable` or
  `picture_too_large` ([decision 0279](../DECISIONS.md#d0279)). Only the
  owner starts a launch: one the agent runtime or an MCP client proposes fails with
  `intent.owner_only` before anything is read, stored or uploaded, and a launch whose `image` the
  proposer's own credential did not upload ends `failed_check` with `image_unreadable`
  ([decision 0236](../DECISIONS.md#d0236)); the agent drafts one with `launch/draft` instead,
  which the owner starts from Telegram (section 7.7, [decision 0285](../DECISIONS.md#d0285)). A `firstBuy` in any asset but `pairWith`, a
  `description` longer than 1,000 characters or a link longer than 200 fails with
  `protocol.bad_args` and stores nothing ([decision 0239](../DECISIONS.md#d0239)). While another
  launch of the agent is under way, before it is signed or ends, a `launchToken` fails with
  `intent.launch_waiting` and stores nothing ([decision 0240](../DECISIONS.md#d0240)). A launch
  whose setting that must be outside the install, such as Genius.fun's `creatorFeeRecipient`,
  names any wallet of the install fails with `intent.own_wallet_recipient` and stores nothing: the
  launchpad pays that account only on a claim binference never makes
  ([decision 0277](../DECISIONS.md#d0277)). A launch whose settings its launchpad does not take
  together fails with `protocol.bad_args`, or with the refusal the launchpad names, and stores
  nothing: `intent.launch_recipient_needed` when they leave its fees to a fee recipient the launch
  does not name, `intent.launch_recipient_unused` when they pay its fees elsewhere while the launch
  names one ([decision 0284](../DECISIONS.md#d0284)).
- `intent/confirm` must name the card's current `cardVersion`. A re-quote that changes the terms
  opens a new card version ([rule 4](../ARCHITECTURE.md#rule-4)), and confirming an old version
  fails with `intent.card_changed`. A Confirm that would take the agent past its rolling 24-hour
  cap with the intents confirmed before it fails with `limit.daily_cap` and changes nothing: the
  card stays open ([decision 0136](../DECISIONS.md#d0136)).
- Every state change pushes `intent/changed`; states and transitions are spec 6.

<a id="section-7-5"></a>

### 7.5 Auto orders, alerts, webhook rules and schedules

| Operation               | Scope     | Write | Local | Args → result                                                                                                                |
| ----------------------- | --------- | ----- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `order/create`          | `propose` | ✓     |       | `OrderRequest` (section 8.2) → `OrderView` awaiting its one card ([decision 0004](../DECISIONS.md#d0004))                    |
| `order/get`             | `read`    |       |       | `{ order }` → `OrderView` with fills                                                                                         |
| `order/list`            | `read`    |       |       | paging, `{ agent?, state? }` → orders with `assets` (section 8.3)                                                            |
| `order/cancel`          | `propose` | ✓     |       | `{ order }` → `OrderView` (braking: no card)                                                                                 |
| `alert/create`          | `propose` | ✓     |       | `{ agent, condition, wake?, expiresAt? }` → `AlertView` (no transaction, no card; section 8.4)                               |
| `alert/list`            | `read`    |       |       | paging, `{ agent?, state? }` → alerts                                                                                        |
| `alert/delete`          | `propose` | ✓     |       | `{ alert }` → `{}`                                                                                                           |
| `webhookRule/create`    | `admin`   | ✓     |       | `WebhookRuleRequest` → `{ rule, url }` awaiting its one card ([decision 0053](../DECISIONS.md#d0053)); the URL is shown once |
| `webhookRule/list`      | `read`    |       |       | → rules without secrets                                                                                                      |
| `webhookRule/events`    | `read`    |       |       | paging, `{ rule }` → what each alert to the rule's URL became, newest first (below)                                          |
| `webhookRule/delete`    | `confirm` | ✓     |       | `{ rule }` → `{}`                                                                                                            |
| `webhookRule/rotateUrl` | `admin`   | ✓     |       | `{ rule }` → `{ url }`                                                                                                       |
| `schedule/create`       | `propose` | ✓     |       | `{ agent, when: { cron, timezone? } \| { at }, prompt }` → `ScheduleView` ([decision 0049](../DECISIONS.md#d0049))           |
| `schedule/list`         | `read`    |       |       | `{ agent? }` → schedules                                                                                                     |
| `schedule/cancel`       | `propose` | ✓     |       | `{ schedule }` → `{}`                                                                                                        |

Alerts are code: the watchers judge them, as they judge auto orders, and the model budget never
pauses them. An agent has at most 50 active alerts; one more fails `alert.too_many`. Their
conditions, how often each fires, and the wake-ups are in section 8.4. `alert/delete` of an alert
that is not active fails `alert.not_found`.

Alerts follow [decision 0244](../DECISIONS.md#d0244): `alert/create` stores an active alert at
once, with no card, journal entry or notice, marked when a client with `propose` alone or a marked
turn set it. It refuses with `protocol.bad_args`, storing nothing, an asset on no chain of the
registry, an account its chain family cannot read, a price or least dollar value of zero, a launch
filter naming a launchpad the engine does not run, and an `expiresAt` not ahead; and with
`market.no_data` a price alert on a token the price watcher cannot price now. `wake` is off by
default. `alert/list` pages oldest first, in every state unless one is named. A client with
`propose` alone deletes only the alerts it set (`auth.scope`).

Webhook rules follow [decision 0299](../DECISIONS.md#d0299):

- `WebhookRuleRequest` is an auto order's bounds (section 8.2) without a trigger:
  `{ agent, wallet?, name, token, side, size, spend?, worstPrice?, maxSlippageBps?, expiresAt?, maxFills?, ratePerMinute? }`.
  `name` is the alert's name, 1 to 64 characters, shown on its card. `size` and `spend` are a buy
  order's or a sell order's (section 8.2). `ratePerMinute` is 1 to 60, default 1. `expiresAt`
  defaults to 30 days ahead. With no `maxFills` a rule fills until it expires or is deleted.
- `webhookRule/create` stores the rule `awaiting_confirmation` and a `webhookRule` intent
  (`{ kind: "webhookRule", rule }`) whose one card shows its bounds and rate, and answers the rule
  with its URL, shown this once. The rule is `active` only on the Confirm of that card; Cancel, the
  card's timer or a freeze ends it as `deleted`. Its URL is `<webhook base>/hook/<rule>/<secret>`,
  the base `remote/status`'s `webhookUrl`, else the loopback listener's.
- It refuses, storing nothing, what `order/create` refuses for a buy or sell order of the same
  token (section 7.5, auto orders), `order.live_fills_off` for a live agent while live fills
  are off, which they are in every install until the second step of turning them on: a rule
  fills in the mode its agent had when it was made ([decisions 0337](../DECISIONS.md#d0337) and
  [0342](../DECISIONS.md#d0342)), `protocol.bad_args` for a rate outside 1 to 60 or a `name`
  that is empty or too long, and `webhook.too_many` for an agent's 21st rule active or awaiting
  its card.
- Each accepted alert becomes a fill intent authorized by the rule
  (`authorizedBy: { webhookRule, event, alertId?, fillsBefore, termsHash? }`, keyed on the
  alert's `webhook_events` row,
  [decision 0338](../DECISIONS.md#d0338)), through the fill path of an auto order (spec 6,
  section 5). `webhookRule/delete` and `webhookRule/rotateUrl` of a rule that is not active or
  awaiting its card fail `webhook.not_found`; a rotation answers the new URL once, and the old
  one gets `404` at once. `WebhookRuleView` gains `ratePerMinute`, `lastAlertAt?`, `intent?`
  (the `webhookRule` intent that carries its card) and `summary?` (what each alert trades, the
  card line `card.webhookRule.buy` or `card.webhookRule.sell` as the engine draws it), and
  `webhookRule/list` answers `assets?`, the info of each token its rules trade or spend, as
  `order/list` does.
- Per [decision 0337](../DECISIONS.md#d0337), a delete and a rotation open no card and apply at
  once. A delete of a rule awaiting its card cancels the card. A rotation makes a new 32-byte
  secret, of which only the SHA-256 is stored, and sends `notice.webhookRotated` naming the
  surface; alerts the old URL took that still wait fill nothing (`url_rotated`). Only the owner's
  own surfaces create a rule: a caller without `confirm` is `auth.scope`. `webhookRule/list`
  answers every rule active or awaiting its card, oldest first, in one page.
- `webhookRule/events` pages through the `webhook_events` rows of one rule in any state, the
  newest first, 50 a page by default: each `WebhookEventView` is
  `{ event, receivedAt, taken, alertId?, fill?, reason?, intent? }`, where `event` is the row,
  `taken` is `accepted`, `repeat` or `rate`, and an accepted alert's `fill` is `filled` or
  `skipped` once its fill ended, with a skip's `reason` and the intent that filled or ended. It
  never carries the alert's body, which is outside content and stays in the inbox. The cursor is
  the last row of the page before, in decimal; one this engine did not write is
  `protocol.bad_args`. A rule with no row, or rows pruned after 90 days, answers an empty page.
- Per [decision 0336](../DECISIONS.md#d0336), an alert fills only if its fill starts within a
  minute of its arrival, a buy and a sale alike; a later one, as one taken while the engine was
  stopped, or one stamped later than now after the clock was set back, is skipped as `late`, and
  one taken while the engine was locked as `engine_locked`. Each alert is judged once and never
  tried again. A rule ends `deleted` with its last fill and at its expiry, and its URL then gets
  `404` ([decision 0337](../DECISIONS.md#d0337)).

Schedules follow decisions [0231](../DECISIONS.md#d0231) to [0233](../DECISIONS.md#d0233):

- `when.cron` is five fields, `minute hour day month weekday`: numbers, `*`, lists, ranges and
  steps, with three-letter English month and weekday names; weekday 7 is Sunday. When both day
  fields name days, a day matches either. It runs on the wall clock of `when.timezone`, else of
  `owner.timezone` as it is now; `when.at` runs once at that instant. A wall time the clocks skip
  runs when they jump past it; one they show twice runs once, at its first occurrence.
- `schedule/create` stores an active schedule at once, with no card, and answers it with its
  `nextAt`. It refuses, storing nothing: an unknown agent (`agent.not_found`), an archived one
  (`agent.archived`), a `when` binference cannot read, an `at` that is not ahead or an expression
  with no run in eight years (`schedule.bad_when`), a prompt over 2,000 characters
  (`protocol.bad_args`), and a 51st active schedule of the agent (`schedule.too_many`). A schedule
  set in a turn that read outside content, or by a client with `propose` alone, is marked, and its
  turns start marked. `ScheduleView.outsideContent` says so ([decision 0247](../DECISIONS.md#d0247)).
- `schedule/list` answers the active schedules, of the agent or every agent, oldest first, with no
  `next`. `schedule/cancel` ends an active schedule at once; one that is not active is
  `schedule.not_found`, and a client with `propose` alone cancels only the schedules it set
  (`auth.scope`).
- Each set and cancel is journaled under `agents.<name>.schedules`, pushed as `config/changed` and
  announced as `notice.scheduleSet` or `notice.scheduleCancelled` (spec 4, section 4).
- The engine runs each schedule whose time came while it is unlocked, once however many runs it
  missed, and stores an `inbox/scheduleDue` message with the run
  ([spec 8, section 3.3](runtime.md#section-3-3)). A run whose agent is gone, archived or frozen,
  whose model budget of the day is spent, whose last wake-up is still untaken, or whose agent
  holds 200 untaken messages starts no turn and is recorded as skipped with that reason
  (`archived`, `frozen`, `budget`, `waiting`, `busy`). `ScheduleView.lastRun` shows the last run.
  A one-time schedule is `ended` after its run.

DCA orders follow [decision 0246](../DECISIONS.md#d0246): `order/create` fills in a `dca`
order's `timezone` with `owner.timezone`, and its `count` of buys is its `maxFills`, none for no
limit. The schedule queue's timer buys once for each period that comes, through the order's fill
with no card, the next period kept first; a period more than 60 seconds late, while the engine was
off or locked or the agent frozen, is recorded as a `missed` skip and never bought, and a buy that
reaches its agent's line past its minute as `late`.

An order that ends because another exit order emptied its position (spec 6, section 5) moves to
`ended` with `endReason: "position_closed"`, and pushes `order/changed`.

Auto orders follow [decision 0189](../DECISIONS.md#d0189):

- `order/create` stores the order `awaiting_confirmation` and an `autoOrder` intent whose one card
  (`card.order.action`) shows its terms with every default filled; it answers the order with
  `intent`. The order becomes `active` only on the Confirm of that card; Cancel, a cancel of the
  intent or a freeze makes it `cancelled`, the card's timer `expired`. Every change pushes
  `order/changed`.
- It refuses, storing nothing: an agent that is unknown (`agent.not_found`), archived
  (`agent.archived`) or frozen (`agent.frozen`); a wallet that is not the agent's
  (`wallet.not_found`); a
  `limit`, `takeProfit`, `stopLoss` or `trailing` order for a token the price watcher cannot price
  now, with no venue read and no pool deep enough (`order.unpriced_token`,
  [decision 0194](../DECISIONS.md#d0194)); such an order, a `dca` or a `copy` order, of a live
  agent while live fills are off (`order.live_fills_off`, decisions [0197](../DECISIONS.md#d0197),
  [0246](../DECISIONS.md#d0246) and [0261](../DECISIONS.md#d0261)); a `maxSlippageBps` above the
  agent's slippage limit for the pair its fills trade, or above the larger of its two limits for a
  `copy` order (`order.slippage_limit`, [decision 0362](../DECISIONS.md#d0362)), while a limit
  tightened later still skips each fill with `slippage`; an `expiresAt` further ahead than the
  agent's `orderExpiryDays` (`order.expiry_limit`, [decision 0364](../DECISIONS.md#d0364)); a `dca` period binference cannot read or with no run in eight
  years (`schedule.bad_when`); a token the registry does not
  list that answers no symbol or no decimals on chain (`asset.unreadable`,
  [decision 0199](../DECISIONS.md#d0199)); and
  with `protocol.bad_args` a token on no chain of the registry or the chain's coin, an expiry not in
  the future, a price, worst price or size of zero, a trailing distance of 0 or `10000`, a share above
  `10000`, a `takeProfit`, `stopLoss` or `trailing` order that does not sell, a `dca` order that
  does not buy or whose `count` and `maxFills` disagree, a buy whose size is not `{ usdMicros }`,
  and a `copy` order that breaks section 8.2's rules for it or follows an account of one of the
  agent's own wallets.
- An order keeps its agent's mode when it was created (`paper`), and the outside-content mark of the
  turn that proposed it (`outsideContent`), which its card shows.
- A freeze moves the agent's `active` orders to `paused` and cancels those awaiting their card; an
  unfreeze moves them back to `active`, or to `expired` past their expiry. A paused order never
  fills.
- `order/cancel` ends an order awaiting its card, active or paused, and cancels its intent's card.
  The owner's clients and the agent runtime cancel any order; a client with `propose` alone only
  the orders it proposed (`auth.scope`). An order that has ended fails `order.wrong_state`.
- `notice.orderExpiring` goes once, 24 hours before an active or paused order expires.

<a id="section-7-6"></a>

### 7.6 Limits, send levels and the address book

| Operation                 | Scope                                                | Write | Args → result                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit/get`               | `read`                                               |       | `{ agent }` → `LimitsView` with `pending?` ([ARCHITECTURE.md section 28](../ARCHITECTURE.md#section-28))                                                                                                                                                                                                                                                                                          |
| `limit/set`               | `confirm` if every change is stricter, else `loosen` | ✓     | `{ agent, changes }` → `LimitsView`; looser changes wait 24 hours; never past the ceiling ([decision 0111](../DECISIONS.md#d0111))                                                                                                                                                                                                                                                                |
| `limit/cancelPending`     | `confirm`                                            | ✓     | `{ agent }` → `LimitsView`                                                                                                                                                                                                                                                                                                                                                                        |
| `sendLevel/get`           | `read`                                               |       | `{ agent }` → `{ level, pending? }`                                                                                                                                                                                                                                                                                                                                                               |
| `sendLevel/set`           | `confirm` if stricter, else `loosen`                 | ✓     | `{ agent, level }` → `{ level, pending? }`; looser waits 24 hours                                                                                                                                                                                                                                                                                                                                 |
| `sendLevel/cancelPending` | `confirm`                                            | ✓     | `{ agent }` → `{ level }`                                                                                                                                                                                                                                                                                                                                                                         |
| `address/list`            | `read`                                               |       | `{ agent }` → entries with `usableAt`, each saved for a destination no bridge rule of the agent's wallets reaches yet with `noRoute`, and `room?: { chain, used, most }[]`: for each chain other than the wallets' that holds a saved address, how many it holds and the most the ceiling's rule for that chain lists ([decisions 0297](../DECISIONS.md#d0297) and [0314](../DECISIONS.md#d0314)) |
| `address/add`             | `admin`, local                                       | ✓     | `{ agent, chain, address, label, ownerKey }` → entry; also saved in the ceiling ([decision 0091](../DECISIONS.md#d0091)); refusals below                                                                                                                                                                                                                                                          |
| `address/remove`          | `confirm`                                            | ✓     | `{ entry }` → `{}`                                                                                                                                                                                                                                                                                                                                                                                |

**Saved addresses on other chains** ([decisions 0297](../DECISIONS.md#d0297),
[0298](../DECISIONS.md#d0298), [0313](../DECISIONS.md#d0313) and
[0314](../DECISIONS.md#d0314)). `address/add`'s `chain` is a chain of the agent's wallets or a
destination chain the registry lists; any other is `address.unknown_chain`. `address` is written
as its chain's family writes it: a checksummed hex address on an `eip155` chain, a base58 address
on Solana. The family's address codec checks it and gives its recipient bytes, 20 or 32, which
the owner key saves into every ceiling of the agent with the chain's id; an address another
family reads, such as a Solana address named for Base, is `address.other_chain`, and any other
text the codec refuses, such as a base58 string that is not 32 bytes, `address.malformed`. On a
wallet chain, a launch wallet of the install is `address.launch_wallet`, a bridge wallet
`address.bridge_wallet` and a venue's contract `address.venue_contract`; on a destination, any
wallet of the install is `address.own_wallet`. A chain whose ceiling rule lists the most it can,
the rescue address among them on its own chain, is `address.chain_full`, as is a list custody
refuses on the write. On Solana the engine reads the account last: an executable program, an
account another program than the System Program owns, an account that holds data such as a
durable nonce, and an address off the ed25519 curve such as a program-derived address are
`address.not_wallet`, and a read that fails `chain.rpc_down`. On an EVM destination it reads the
account's code last the same way: a token's own contract, which answers a token's supply and
decimals, is `address.not_wallet` ([decision 0318](../DECISIONS.md#d0318)). An address saved for a destination
rewrites every live wallet's call rules with its venues and cap as they are, planned before any
is written; a plan that changes no rule signs nothing, and one that moved a ceiling is read back,
stored and announced as `ceiling/set` is ([decision 0313](../DECISIONS.md#d0313)). Its entry
carries `noRoute` while no bridge rule of the agent's wallets reaches its chain. The entry's
`address` is a CAIP-10 account of its chain, and a send or a bridge pays it only on that chain: a
send on a wallet chain pays only the addresses saved for that chain. Clients show the address
whole, never shortened, since a Solana address carries no checksum.

The engine decides what is stricter, and only a clearly stricter change applies at once: a lower
cap, slippage, impact, tax or time, a higher liquidity floor, fewer venues, an
allow list that keeps only tokens it listed (never an empty one, which allows every token), a deny
list that keeps every token it listed, a larger gas reserve on every chain, a higher send level.
Every other change is a loosening, which waits 24 hours, is announced on every surface and can be
cancelled. A venue that a live wallet's ceiling leaves out is `limit.over_ceiling`: only the owner
key adds it to the ceiling ([decision 0111](../DECISIONS.md#d0111)). A venue that trades on a
launch's own contracts, such as a Genius.fun curve, or only launches tokens, such as Brew
([decision 0282](../DECISIONS.md#d0282)), is `limit.needs_launch_wallet` for a live agent without
a live launch wallet: its live trades run from a launch wallet alone, whose ceiling
allows the calls of every launchpad the install ran when it was made; a live agent whose launch
wallet's ceiling lacks one of the venue's launch calls gets `limit.over_ceiling`, and a paper
agent adds it with no ceiling to check ([decisions 0212](../DECISIONS.md#d0212),
[0217](../DECISIONS.md#d0217) and [0218](../DECISIONS.md#d0218)). A venue only a bridge wallet
uses, such as Relay, is `limit.needs_bridge_wallet` for a live agent without a live bridge wallet,
and `limit.bridge_ceiling` while that wallet's ceiling lacks one of its calls; no main wallet's
ceiling is checked for it, and no bridge wallet's ceiling for any other venue
([decision 0307](../DECISIONS.md#d0307)).

<a id="section-7-7"></a>

### 7.7 Chat, notes and usage

| Operation                    | Scope                  | Write | Args → result                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat/post`                  | `chat`                 | ✓     | `{ agent, text, images? }` → `{ session, turn }`                                                                                                                                                                                                                                                                                                                    |
| `chat/messages`              | `read` (R)             |       | `{ agent, session?, cursor?, limit? }` → messages                                                                                                                                                                                                                                                                                                                   |
| `chat/stop`                  | `chat`                 | ✓     | `{ agent }` → `{}`: ends the running turn; confirmed transactions are untouched                                                                                                                                                                                                                                                                                     |
| `chat/clear`                 | `chat`                 | ✓     | `{ agent }` → `{ session }`: starts a new session (`/clear`)                                                                                                                                                                                                                                                                                                        |
| `turn/start`                 | `agent`                | ✓     | `{ agent, session, turn, messages, outsideContent }` → `{ budgetLeftMicros }`; fails `agent.budget` with `details.resumesAt`, or `agent.frozen` for a turn only a schedule or an alert starts ([spec 8, section 4.3](runtime.md#section-4-3))                                                                                                                       |
| `turn/mark`                  | `agent`                | ✓     | `{ agent, turn }` → `{}`: the turn holds outside content from now on                                                                                                                                                                                                                                                                                                |
| `turn/say`                   | `agent`                | ✓     | `{ agent, session, turn, text, final }` → `{}`; drafts are edited in place until `final`                                                                                                                                                                                                                                                                            |
| `turn/status`                | `agent`                |       | `{ agent, turn, statusKey, values? }` → `{}`                                                                                                                                                                                                                                                                                                                        |
| `turn/progress`              | `agent`                |       | `{ agent, turn, progressKey, values? }` → `{}`: one line of the turn's work now, such as a tool it runs, pushed as `chat/progress` and kept nowhere ([decision 0371](../DECISIONS.md#d0371))                                                                                                                                                                        |
| `turn/deposit`               | `agent`                |       | `{ agent, turn, wallet? }` → `{ wallets }`: the wallets the agent runs from, or the one named, read as `wallet/list` answers them, never an extra launch or bridge wallet, pushed as `chat/deposit` with the agent's mode and freeze, so the owner sees each address and its QR code; no such wallet is `wallet.not_found` ([decision 0380](../DECISIONS.md#d0380)) |
| `turn/chart`                 | `agent`                |       | `{ agent, turn, chart }` → `{ chart }`: a pie of 1 to 12 segments, or bars, areas or lines of 1 to 8 series over 1 to 100 categories, pushed as `chat/chart` ([decision 0387](../DECISIONS.md#d0387))                                                                                                                                                               |
| `turn/credential`            | `agent`                |       | `{ agent, session, turn, name, reason?, allowedHosts?, timeoutSeconds? }` → a `CredentialRequestView`: the agent asks the owner for a credential, from the current runtime only ([decision 0388](../DECISIONS.md#d0388))                                                                                                                                            |
| `credential/answer`          | `chat`                 |       | `{ agent, request, value, allowedHosts }` → `{ session, turn }`: stores the value and starts the agent's next turn with what arrived; `credential.closed` when the request is no longer open                                                                                                                                                                        |
| `credential/skip`            | `chat`                 |       | `{ agent, request }` → `{ session, turn }`: declines the request                                                                                                                                                                                                                                                                                                    |
| `chat/openCredentialRequest` | `read`                 |       | `{ agent }` → `{ request? }`                                                                                                                                                                                                                                                                                                                                        |
| `credential/list`            | `read`                 |       | `{}` → `{ items }`: names, hosts and when stored, never a value                                                                                                                                                                                                                                                                                                     |
| `credential/delete`          | `propose`              |       | `{ name }` → `{ name }`: removes a credential, purged in 30 days; `credential.not_found`                                                                                                                                                                                                                                                                            |
| `credential/set`             | `admin`                |       | `{ name, value, allowedHosts }` → a `CredentialView`: the owner stores a credential with no request, and every open request of its name closes as stored                                                                                                                                                                                                            |
| `turn/reasoning`             | `agent`                |       | `{ agent, turn, text, final }` → `{}`: the reasoning of the turn's current model call so far, or with `final` the whole reasoning of a call that answered, at most 50,000 characters, pushed as `chat/reasoning` and kept nowhere ([decision 0377](../DECISIONS.md#d0377))                                                                                          |
| `turn/end`                   | `agent`                | ✓     | `{ agent, turn, outcome }` → `{}`                                                                                                                                                                                                                                                                                                                                   |
| `turn/ask`                   | `agent`                | ✓     | `{ agent, session, turn, text, choices }` → `QuestionView`: the agent's question to the owner with 2 to 4 answer buttons (below)                                                                                                                                                                                                                                    |
| `chat/answer`                | `chat`                 | ✓     | `{ agent, question, choice }` → `{ session, turn }`: the owner picks a choice of an open question by its place, `0` to `3`; fails `question.not_found` or `question.closed`                                                                                                                                                                                         |
| `chat/openQuestion`          | `read`                 |       | `{ agent }` → `{ question? }`: the agent's open question as a `QuestionView`, or none ([decision 0248](../DECISIONS.md#d0248))                                                                                                                                                                                                                                      |
| `launch/draft`               | `agent`                | ✓     | `{ agent, session, turn, launch, photo?: { message, image } }` → `{ draft, expiresAt }`: the agent's token launch draft, which only the owner starts (below)                                                                                                                                                                                                        |
| `launch/openDraft`           | `read`                 |       | `{ agent }` → `{ draft? }`: the agent's open launch draft as `{ draft, expiresAt, lines, assets, picture?: { bytes } }`, or none ([decision 0345](../DECISIONS.md#d0345))                                                                                                                                                                                           |
| `launch/draftPicture`        | `chat`                 |       | `{ agent, draft, offset? }` → an `ImagePart` of the draft's photo, as `inbox/readImage` answers; fails `image.not_found`                                                                                                                                                                                                                                            |
| `usage/record`               | `agent`                | ✓     | `{ agent, turn, model, inputTokens, outputTokens, cachedTokens, usdMicros }` → `{ budgetLeftMicros, resumesAt? }`; `resumesAt` once nothing is left                                                                                                                                                                                                                 |
| `inbox/list`                 | `agent`                |       | paging, `{ agent? }` → the untaken inbox messages, in the order they arrived                                                                                                                                                                                                                                                                                        |
| `inbox/take`                 | `agent`                | ✓     | `{ messages }` → `{}`: the runtime holds them in its chat queue                                                                                                                                                                                                                                                                                                     |
| `inbox/readImage`            | `agent`                |       | `{ agent, message, image, offset? }` → `{ contentType, bytes, offset, data, next? }`: 512 KiB of an image of the agent's own `inbox/message`, in base64, from `offset`; `next` is where the next part starts                                                                                                                                                        |
| `image/view`                 | `agent`                |       | `{ agent, url? \| path?, offset? }` → an `ImagePart` of an image at a public address or in a file on the engine's machine, exactly one of the two; fails `image.not_public`, `image.walled`, `image.outside_workspace`, `image.not_found` ([decision 0385](../DECISIONS.md#d0385))                                                                                  |
| `image/store`                | `agent`                |       | `{ agent, job, place, offset, total, data }` → `{ image?, path? }`: one part of an image the agent made, in order, at most 512 KiB; the last part saves it in the workspace under `media/made/<date>/` and answers its id and path; from the current runtime only ([decision 0392](../DECISIONS.md#d0392))                                                          |
| `image/made`                 | `agent`                |       | `{ agent, session, turn, surface, prompt, images, failed? }` → `{}`: ends an image job, pushes `chat/images` and wakes the agent with a message from the engine                                                                                                                                                                                                     |
| `image/read`                 | `read`                 |       | `{ agent, image, offset? }` → an `ImagePart` of an image the agent made, by its id; `image.not_found` once the engine no longer holds it                                                                                                                                                                                                                            |
| `image/show`                 | `agent`                |       | `{ agent, turn, paths, caption }` → `{ images }`: shows the owner, in the chat of the turn, up to 4 images already on the engine's machine, read as `image/view` reads a path, and pushes them as `chat/images` (decision 0399); one that cannot be read refuses all with its `image.*` code                                                                        |
| `usage/get`                  | `read`                 |       | `{ agent?, from, to }` → spend by day and model, and the budget                                                                                                                                                                                                                                                                                                     |
| `notes/search`               | `read` (R)             |       | `{ agent, query, limit? }` → notes with their origin label                                                                                                                                                                                                                                                                                                          |
| `notes/list`                 | `read` (R)             |       | `{ agent, cursor?, limit? }` → notes                                                                                                                                                                                                                                                                                                                                |
| `notes/write`                | `agent` or `admin` (R) | ✓     | `{ agent, text, origin }` → note; `origin` is set by the engine from the caller                                                                                                                                                                                                                                                                                     |
| `notes/delete`               | `admin` (R)            | ✓     | `{ note }` → `{}`                                                                                                                                                                                                                                                                                                                                                   |
| `notes/get`                  | `read` (R)             |       | `{ agent, note }` → the agent's note in full, with its origin label; a note of another agent or one removed is `note.not_found` ([decision 0384](../DECISIONS.md#d0384))                                                                                                                                                                                            |
| `notes/forget`               | `agent` (R)            | ✓     | `{ agent, note }` → `{}`: removes one of the agent's own notes from lists and searches; one of another agent's or removed before is `note.not_found` ([decision 0384](../DECISIONS.md#d0384))                                                                                                                                                                       |

`chat/post` stores an `inbox/message` before it replies; its `turn` is the turn reserved for the
message, which a message that joins a running turn leaves unused
([spec 8, section 3.2](runtime.md#section-3-2)). A proposal of the agent runtime takes the
outside-content mark of its agent's running turn ([spec 8, section 4.3](runtime.md#section-4-3)).

**The agent's questions.** `turn/ask` is how the `ask_owner` tool asks
([spec 8, section 6.4](runtime.md#section-6-4)):

- `turn` is the agent's running turn, else `protocol.bad_args`. `text` is the agent's words, at
  most 500 characters; `choices` are 2 to 4 distinct labels, each 1 to 64 characters on one line.
  A choice that starts with a status icon of [spec 4, section 1](cards-and-messages.md#section-1)
  is `protocol.bad_args`, so a question never looks like a card. The engine stores the question
  (`qst_…`) and answers its `QuestionView`:
  `{ question, agent, session, turn, text, choices, state: open | answered | closed, answer?: { choice?, typed?, surface, at }, closeReason?, createdAt, closesAt }`.
- An agent has one open question. A new one closes the one before with `closeReason: "replaced"`;
  `chat/clear` closes it with `cleared`, and once it is 24 hours old the first call that meets it
  closes it with `expired` ([decision 0204](../DECISIONS.md#d0204)).
- The engine draws it on every chat surface: in Telegram as a message with one button per choice
  (callback kind `q`, [spec 4, section 2](cards-and-messages.md#section-2)), and as `chat/question`
  on the agent's chat topic for the console and terminal chat; its words are in
  [spec 4, section 8.2](cards-and-messages.md#section-8-2). A page that opens later reads the open
  question with `chat/openQuestion`, which closes one 24 hours old as it meets it
  ([decision 0248](../DECISIONS.md#d0248)).
- The first answer wins, from any surface: a press in Telegram, `chat/answer`, or the owner's next
  `chat/post` to the agent while the question is open, which answers it as typed text. One write
  closes the question as `answered` and stores the `inbox/message`, whose `text` is the choice's
  label, or the typed text, and whose `answer` is `{ question, choice }` for a button. Every copy
  then shows the answer and loses its buttons, and `chat/questionClosed` is pushed. A later press
  changes nothing.
- An answer is only a message to the agent. It confirms nothing: a proposal that follows it opens
  its own card.

**The agent's launch drafts** ([decisions 0285](../DECISIONS.md#d0285) and
[0286](../DECISIONS.md#d0286)). `launch/draft` is how the `launch_draft` tool suggests a token
launch ([spec 8, section 6.5](runtime.md#section-6-5)); a `launchToken` the runtime proposes stays
`intent.owner_only`:

- Only the runtime the engine runs now calls it (else `auth.scope`), in its agent's running turn
  (else `protocol.bad_args`). `launch` is the launch's terms without `kind`, `agent`, `wallet` or
  `image`. The engine checks them as `intent/propose` checks a launch before it stores anything:
  `agent.paper_only` for a paper agent, `intent.launch_waiting` while another launch of the agent
  is under way, every refusal of section 8.1's launch rules, and `intent.launch_wallet_missing`
  for an agent with no live launch wallet.
- On a launchpad that uploads or writes the picture, `photo` names one image of one of the
  agent's own `inbox/message`s from Telegram that the running turn took at `turn/start`,
  `tg:<file_id>`; any other, a photo of an earlier turn among them, is `image.not_found`, and
  a missing one `protocol.bad_args`. The engine reads it once, as a launch reads an upload
  (`image.format`, `image.too_large`, `image.unreadable`, and for a picture the create call writes,
  `intent.launch_picture_too_large`), and keeps its bytes. On a launchpad that takes a picture
  link, `photo` is absent and the link is the launchpad's `link` setting.
- The draft lives in memory for 10 minutes; a new draft of the agent replaces the open one, and a
  restart forgets it. Nothing is uploaded, quoted or stored. `chat/launchDraft`
  `{ agent, draft, expiresAt }` tells the agent's chat topic, and `chat/launchDraftClosed`
  `{ agent, draft, outcome: started | dropped | expired | replaced | failed, intent?, error?, reason? }`
  how it ended: `started` only for a launch still on its way to its card, and `failed` with the
  intent and its `reason` for one that ended before its card, such as one the policy refused.
- Telegram shows it to the owner with Start launch and Drop
  ([spec 4, section 8.5](cards-and-messages.md#section-8-5)). The owner's Start, checked against
  the owner's numeric Telegram id by the engine itself, takes the draft and is answered at once;
  the engine then proposes the draft's request in the background, within 2 minutes and stopped
  at shutdown, through `intent/propose` as the owner on Telegram, with the photo put on the
  upload shelf under the owner's Telegram credential: the one proposal the owner's chat makes.
  The launch carries the outside-content mark of the turn that drafted it, so its card warns as
  that turn's own proposals would, and a draft from a clean turn carries none. The launch then
  runs as any launch, never in auto mode: its upload, its pin and its card, which the owner
  confirms.
- The console shows the open draft read-only ([decision 0345](../DECISIONS.md#d0345)):
  `launch/openDraft` answers its id, its end, the `CardLineView`s Telegram's message shows between
  its header and footer with their `assets`, and the size of the owner's photo it holds, absent
  for a picture link; none once the draft ended or its time is up. `launch/draftPicture` answers
  the photo in parts of at most 512 KiB, as `inbox/readImage` does; a draft no longer open, another
  draft's id or a draft with no photo is `image.not_found`, and an offset past the photo
  `protocol.bad_args`. The console reads the draft when the chat opens, at each draft push and
  after a gap in the topic, and offers no Start and no Drop.

`images` are upload ids from `upload/start` (section 7.9): at most 4 per message, each a PNG, JPEG
or WebP of at most 5 MiB. A message with images marks the turn as outside content
([rule 13](../ARCHITECTURE.md#rule-13)). Telegram images reach the engine through Telegram and need
no upload: each is named `tg:<file_id>`, the bot's id of the photo's largest size
([decision 0178](../DECISIONS.md#d0178)), or of a document whose MIME type is one of the three.

**Reading an image.** `inbox/readImage` answers only the engine's current runtime, for an image the
agent's own `inbox/message` names; else `image.not_found`. The engine reads the image once, from
the upload or through the bot's `getFile`, and holds it in memory until its last part is read or
for 2 minutes. An image over 5 MiB is `image.too_large`, one whose first bytes are not a PNG, JPEG
or WebP is `image.format`, and one its source no longer has (an expired upload, a file id Telegram
refuses) is `image.unreadable`; Telegram out of reach is `telegram.unreachable`
([decision 0227](../DECISIONS.md#d0227)).

**Viewing an image.** `image/view` answers only the engine's current runtime, with the same parts,
hold and checks. An address goes through the outbound HTTP to public addresses only, else
`image.not_public`; an answer that is no success is `image.not_found`. A file, absolute or under
the owner's home folder, is read at its real path; one inside the state folder, its workspace
aside, is `image.walled`, and one that is not there is `image.not_found`
([decision 0385](../DECISIONS.md#d0385)).

<a id="section-7-8"></a>

### 7.8 Models, plugins and skills

| Operation        | Scope     | Write | Local | Args → result                                                                                                                                                                                                                             |
| ---------------- | --------- | ----- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model/list`     | `read`    |       |       | `{ agent? }` → configured models by role, with prices when known; with `agent`, `current: true` marks the model its next turn uses for each role ([decision 0204](../DECISIONS.md#d0204))                                                 |
| `model/set`      | `confirm` | ✓     |       | `{ agent, role, model }` → the agent's models (`/ai`); a model not configured is `protocol.bad_args`, and the role's own configured model clears the pick                                                                                 |
| `plugin/list`    | `read`    |       |       | → installed plugins, tiers, permissions, state; a community plugin's provenance, publisher, why it is off and its tools as the agent names them                                                                                           |
| `plugin/add`     | `admin`   | ✓     | ✓     | `{ source, hash, accepted?, typedName? }` → `{ job }`; the permission review (below)                                                                                                                                                      |
| `plugin/enable`  | `admin`   | ✓     |       | `{ plugin }` → plugin                                                                                                                                                                                                                     |
| `plugin/disable` | `confirm` | ✓     |       | `{ plugin }` → plugin (braking)                                                                                                                                                                                                           |
| `plugin/remove`  | `admin`   | ✓     |       | `{ plugin }` → `{}`                                                                                                                                                                                                                       |
| `plugin/call`    | `agent`   |       |       | `{ agent, plugin, tool, input }` → `{ output }`: one tool of an enabled community plugin, for the agent's runtime; every call marks the agent's running turn as outside content ([decision 0349](../DECISIONS.md#d0349))                  |
| `skill/list`     | `read`    |       |       | `{ agent? }` → skills: with `agent`, each its index holds, with `description`, `location` and `place` ([decision 0207](../DECISIONS.md#d0207))                                                                                            |
| `skill/read`     | `read`    |       |       | `{ agent, skill, file? }` → `{ skill, place, location, file, text }`: one file of a skill `skill/list` gives the agent, `SKILL.md` unless `file` names another; fails `skill.not_found`, and a path outside the skill `protocol.bad_args` |
| `skill/add`      | `admin`   | ✓     | ✓     | `{ source, hash }` → `{ job }`; the install lint runs first                                                                                                                                                                               |
| `skill/remove`   | `admin`   | ✓     |       | `{ skill }` → `{}`                                                                                                                                                                                                                        |

**The permission review** ([ARCHITECTURE.md section 14](../ARCHITECTURE.md#section-14),
[decision 0348](../DECISIONS.md#d0348)). `source` is `npm:<name>@<version>`, an exact version, and
`hash` its npm integrity, `sha512-` and the base64 digest. A `plugin/add` without `accepted`
fetches the version, checks its integrity and npm provenance, reads its manifest and ends its job
with `plugin.review_needed`, whose `details.review` is the JSON text of
`{ plugin, version, source, hash, publisher?, workflow?, provenance: verified | none, kinds, hosts, tools, configKeys, digest, widens?: { from, added, publisher?: { from?, to? }, lostProvenance?, older? } }`:
the plugin's id, what it declares, every entry of every list, `hash` the SHA-256 of its files that
pins it, `publisher` the source repository its provenance names or else npm's account,
`workflow` the build workflow when it lives in another repository, and `digest` the SHA-256 of
the package, version, integrity, pin and declarations. A manifest declares at most 16 hosts of up
to 100 characters, 32 tools and 64 config keys of up to 64 characters, so the review always fits
the terminal whole; only `binference plugin add` shows it. The same call with `accepted` set to
that `digest` installs it, and for a plugin without provenance only with `typedName` set to its
id; a `digest` or name that no longer matches is `plugin.review_needed` again. An update of an
installed plugin is a `plugin/add` of another version of the same package: one that is newer,
declares nothing more, keeps its provenance and comes from the same publisher installs with the
old acceptance; any other waits for its own `accepted`, the old version running meanwhile, its
`widens` naming what it adds (`added`, each a list), another publisher (`publisher`, either side
absent when npm names none), lost provenance (`lostProvenance`) or an older version (`older`).
A version the registry does not serve, or one it is too busy to serve, is `plugin.fetch_failed`
with `details.reason` (`not_published`, `rate_limited`, `registry_unreachable`, `bad_answer`);
another integrity is `plugin.hash_mismatch`; an attestation that does not verify, or one signed
by an issuer other than GitHub Actions or GitLab, is `plugin.provenance_failed`; a package, file
or manifest it cannot install is `plugin.invalid`; an id another package holds is
`plugin.id_taken`; a new plugin past 64 installed is `plugin.too_many`; files it cannot write
are `plugin.install_failed`, the installed version running on. While an install runs, the same
`plugin/add` gets its job, and any other `protocol.busy` with its id in `details.job`. A plugin
lock that does not read answers every plugin operation `plugin.lock_unreadable` and is never
written over.

`plugin/enable`, `plugin/disable` and `plugin/remove` name a plugin by its `plg_` id. A disable
stops the plugin at once and takes its tools out of the agent's index (`disabledReason: owner`);
the host turns a plugin off after 5 crashes in 10 minutes (`crashes`) or when its files no longer
match its pin (`changed`). An enable answers the plugin as it stands once its start settled. A
remove takes the data folder first: one that stays is `plugin.data_not_removed`, or
`plugin.launcher_unreachable` in the image ([decision 0351](../DECISIONS.md#d0351)), and the
plugin stays installed. `plugin/call` answers `plugin.not_found`, `plugin.disabled`, or
`plugin.call_failed` with the host's reason in `details.reason`.

<a id="section-7-9"></a>

### 7.9 Settings, ledger and operations

| Operation            | Scope                      | Write | Local | Args → result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------- | ----- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/read`        | `admin`                    |       |       | → the config with every secret source shown as its kind only                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `config/change`      | `admin`                    | ✓     |       | `{ patch, reason? }` → `{ config, restartNeeded }`: a JSON merge patch over `config.json5`, edited in place and checked first; journaled and announced ([decision 0208](../DECISIONS.md#d0208))                                                                                                                                                                                                                                                                                                                         |
| `config/history`     | `read`                     |       |       | paging → journal entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `config/view`        | `read`                     |       |       | `{ path? }` → `{ value?, rules, hash }`: the config, or one dotted key, every secret source shown as its kind, what each key under it takes, and the SHA-256 of `config.json5` ([decisions 0393](../DECISIONS.md#d0393) and [0395](../DECISIONS.md#d0395))                                                                                                                                                                                                                                                              |
| `config/propose`     | `propose`                  | ✓     |       | `{ patch, reason?, agent?, baseHash?, replacePaths? }` → `IntentView`: a `configChange` card for a JSON merge patch, applied only on the owner's tap; `config.changed` when the file's hash is not `baseHash`, `config.list_shrinks` for a list it shortens that `replacePaths` does not name, `config.secret_unreadable` for a secret source with nothing behind it; refused to an MCP client ([decision 0395](../DECISIONS.md#d0395))                                                                                 |
| `engine/restart`     | `admin`                    | ✓     |       | `{}` → `{}`: restarts binference in its own process after its shutdown sequence; the next engine sends `notice.restarted` ([decision 0395](../DECISIONS.md#d0395))                                                                                                                                                                                                                                                                                                                                                      |
| `ledger/list`        | `read`                     |       |       | paging, `{ agent?, from?, to? }` → entries with their hashes                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ledger/export`      | `read`                     | ✓     |       | `{ agent?, from?, to?, mode? }` → file (CSV) of `live` (default) or `paper` fills                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `device/pair`        | `admin`                    |       | ✓     | → `{ link, expiresAt }`: a new single-use console pairing link, valid 10 minutes, shown once ([decision 0155](../DECISIONS.md#d0155))                                                                                                                                                                                                                                                                                                                                                                                   |
| `device/list`        | `admin`                    |       |       | → devices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `device/revoke`      | `confirm`                  | ✓     |       | `{ device }` → `{}`; the device's open connections end with `bye auth.revoked` ([decision 0155](../DECISIONS.md#d0155)), and its browser push subscriptions are dropped                                                                                                                                                                                                                                                                                                                                                 |
| `webPush/status`     | `read`                     |       |       | → `{ publicKey, registered }`: the engine's VAPID public key (RFC 8292) and whether the calling console device holds a browser push subscription ([decision 0158](../DECISIONS.md#d0158))                                                                                                                                                                                                                                                                                                                               |
| `webPush/register`   | `confirm`, device only     | ✓     |       | `{ subscription: { endpoint, keys: { p256dh, auth } } }` → `{}`: the calling console device's browser push subscription, as `PushSubscription.toJSON()` gives it; the endpoint is HTTPS on a named host that resolves to public internet addresses only (one resolving to a private, loopback, link-local or multicast address is `protocol.bad_args`, and each push checks the addresses again as it connects); an endpoint registered before takes the new keys and device; a device keeps its newest 4 subscriptions |
| `webPush/unregister` | `confirm`, device only     | ✓     |       | `{ endpoint }` → `{}`: drops the calling device's subscription at that endpoint; one it does not hold changes nothing                                                                                                                                                                                                                                                                                                                                                                                                   |
| `token/list`         | `admin`                    |       |       | → tokens without secrets, with `expiresAt` for one that expires                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `token/create`       | `admin`                    | ✓     | ✓     | `{ label, scopes }` → `{ token }`, shown once; unserved since [decision 0154](../DECISIONS.md#d0154), as its result would keep the secret in the idempotency store                                                                                                                                                                                                                                                                                                                                                      |
| `token/revoke`       | `confirm`                  | ✓     |       | `{ token }` → `{}`; fails `token.not_found`; the token's open connections end with `bye auth.revoked` ([decision 0159](../DECISIONS.md#d0159))                                                                                                                                                                                                                                                                                                                                                                          |
| `token/register`     | `admin`                    | ✓     | ✓     | `{ label, kind, scopes, secretHash, expiresAt? }` → the token as `token/list` shows it, from the SHA-256 (hex) of a secret the CLI made; `kind`: `mcp` or `custom`; `expiresAt` at most 90 days ahead; a held hash, another expiry, or an `mcp` token with a scope beyond `read` and `propose` is `protocol.bad_args`, and an `mcp` token signs in with those two at most (decisions [0154](../DECISIONS.md#d0154), [0159](../DECISIONS.md#d0159))                                                                      |
| `backup/list`        | `read`                     |       |       | → backups, newest first, each `{ backup, kind, bytes, createdAt, verifiedAt? }`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `backup/create`      | `admin`                    | ✓     |       | `{ copyTo? }` → `{ job }`: a `manual` backup, kept until the owner removes it, its second copy in `copyTo` (an absolute folder) or else `backups.copyTo`; the job ends with the backup as `backup/list` shows it, or fails with a `backup` code; while one runs, the answer is its job                                                                                                                                                                                                                                  |
| `backup/restore`     | `admin`                    | ✓     | ✓     | `{ backup }` → `{ job }`; unserved in v1 ([decision 0152](../DECISIONS.md#d0152)): the restore needs the owner key for its whole length and replaces the database the engine holds open, then the engine must start again, which it cannot do itself; `binference backup restore <file>` restores in the CLI, between a stop and a start                                                                                                                                                                                |
| `update/check`       | `read`                     |       |       | → `{ current, latest?, channel, notes?, releaseNotes? }`; `releaseNotes` is `{ en: string[], zh: string[] }`, at most 5 lines of at most 200 characters in each language, from the release (spec 4, section 4.2); read from npm's registry at once, recording and announcing nothing; a registry that cannot be read is `update.registry_unreachable` ([decision 0355](../DECISIONS.md#d0355))                                                                                                                          |
| `update/apply`       | `admin`                    | ✓     | ✓     | `{ version? }` → `{ job }`; unserved in v1 ([decision 0356](../DECISIONS.md#d0356)): it answers `update.terminal_only`, and `binference update` updates in the CLI, between a stop and a start                                                                                                                                                                                                                                                                                                                          |
| `check/run`          | `read`; `admin` with `fix` | ✓     |       | `{ fix?, only? }` → `{ job }`; findings carry stable check ids                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `report/create`      | `admin`                    | ✓     |       | `{}` → `{ job }`; unserved in v1 ([decision 0263](../DECISIONS.md#d0263)): `binference report` writes the redacted support bundle in the CLI, so it exists while the engine is stopped                                                                                                                                                                                                                                                                                                                                  |
| `log/follow`         | `admin`                    |       |       | `{ level? }` → `{}`; lines arrive on topic `log`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `log/unfollow`       | `admin`                    |       |       | `{}` → `{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `remote/status`      | `read`                     |       |       | → `RemoteView` (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `remote/enable`      | `admin`                    | ✓     | ✓     | `{ mini?, webhooks? }` → `{ job }`; the job ends with the `RemoteView` after the change (below)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `remote/disable`     | `confirm`                  | ✓     |       | `{}` → `{ stillPublished? }` (braking): removes what binference published, then names each handler that still publishes the engine's or the webhook listener's port, each `{ port, mount?, target, isPublic }` ([decision 0341](../DECISIONS.md#d0341))                                                                                                                                                                                                                                                                 |
| `identity/get`       | `read`                     |       |       | `{ agent }` → `{ registration? }`: the agent's ERC-8004 registration as binference stored it, `{ registry: AccountRef, onchainId, txHash, registeredAt, file }`, absent when it has none                                                                                                                                                                                                                                                                                                                                |
| `identity/allow`     | `admin`                    | ✓     | ✓     | `{ agent, ownerKey }` → `{ wallet, changed }`: the owner's opt-in, the registry's call written into the main wallet's ceiling; below                                                                                                                                                                                                                                                                                                                                                                                    |
| `identity/register`  | `propose`                  | ✓     |       | `{ agent, description? }` → `IntentView` awaiting a tap ([decisions 0071](../DECISIONS.md#d0071) and [0335](../DECISIONS.md#d0335)); below                                                                                                                                                                                                                                                                                                                                                                              |
| `cex/status`         | `read`                     |       |       | → the Binance connection state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `cex/connect`        | `admin`                    | ✓     | ✓     | `{}` → `{ authorizeUrl }`; the OAuth flow returns to `127.0.0.1`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `cex/disconnect`     | `confirm`                  | ✓     |       | `{}` → `{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `upload/start`       | `chat`                     |       |       | `{ contentType, bytes }` → `{ url, expiresAt }` for `POST /upload/:ticket`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `push/subscribe`     | any                        |       |       | `{ topics }` → `{ seqs, resync? }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `push/unsubscribe`   | any                        |       |       | `{ topics }` → `{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

A **device only** operation is refused with `auth.device_only` for any caller but a paired console
device, whatever its scopes: a browser push subscription belongs to the device that registers it.
When a card version opens, and when it closes by an answer or its timer, the engine sends each
registered browser a push through its push service (RFC 8030), encrypted to the browser
(RFC 8291) and signed with the engine's VAPID key (RFC 8292). The message names the intent and
the card, never an amount, an address or a name; the console shows the card from the engine, and
a Confirm still needs the device's signed connection. A push service that answers 404 or 410
drops the subscription ([decision 0158](../DECISIONS.md#d0158)).

**Remote access** ([decision 0051](../DECISIONS.md#d0051)). `RemoteView` is
`{ tailscale: absent | stopped | running, miniUrl?, webhookUrl?, published?: { mini, webhooks }, problems?: [code], checkedAt? }`.
`miniUrl` is the `serve` address of the Mini App, `remote.publicUrl`; `webhookUrl` the `funnel`
base of the webhook path, on a port of its own, never the Mini App's. `problems` names what
`binference check` also fails: `logged_out` (Tailscale is not signed in), `https_off` (the
tailnet has no HTTPS certificates), `funnel_denied` (the tailnet's policy does not let this
machine use `funnel`), `funnel_extra` (`funnel` publishes more than the webhook path),
`engine_exposed` (the engine's port answers on an address beyond loopback) and `serve_changed`
(`serve` at the Mini App's address points somewhere binference did not set). `remote/enable`
sets `serve` for `mini` and `funnel` for `webhooks`, writes `remote.publicUrl` and
`remote.webhooks` through the config journal, and its job fails `remote.tailscale_missing`,
`remote.logged_out`, `remote.https_off` or `remote.funnel_denied`, changing nothing.
Per [decision 0340](../DECISIONS.md#d0340): the Mini App takes port 443, private to the
tailnet, with one handler at `/` to the engine's port; the webhook path takes port 8443, public,
with one handler at `/hook/` to the webhook listener, so `webhookUrl` is `https://<name>:8443`.
`mini` and `webhooks` default to `false`, and a call with neither is `protocol.bad_args`. Every
check runs before any change: a handler binference did not set on either port is
`remote.port_taken`, a tailnet that lets this machine use `funnel` but not on 8443
`remote.funnel_port`, an `engine.webhookPort` equal to `engine.port` `remote.same_port`. After
the change binference reads Tailscale back: Tailscale's refusal of an account that may not change
its settings is `remote.not_operator`, any other failure, a call that ran past its time or was
stopped, or a change the read does not show, `remote.not_applied`, and every part the job asked
for that a fresh read shows as binference sets it is taken off again. One remote job runs at a
time: an enable for the same parts answers the running job, one for other parts runs after it.
The job ends within 90 seconds. One read of Tailscale is kept 5 seconds, shared by
`remote/status` and the base of a webhook rule's URL; while `remote.webhooks` records the path
published and Tailscale does not answer, `webhookRule/create` and `webhookRule/rotateUrl` fail
with the Tailscale code, storing nothing.

Per [decision 0341](../DECISIONS.md#d0341): `remote/disable` stops a running enable job and
waits for its undo, takes off binference's handlers that are exactly as it set them, then reads
Tailscale back. `stillPublished` names every handler or TCP forward, on any port, that still
publishes the engine's or the webhook listener's port; binference never touches it. The records
are written from what Tailscale holds then, and `remote.publicUrl` is removed only when it names
the Mini App's Tailscale address. With no Tailscale CLI found while a record says something is
published, it fails `remote.tailscale_missing` and keeps the records; a daemon that does not
answer is `remote.logged_out`, a refusal `remote.not_operator`, a read back that fails
`remote.not_applied`. Whenever the CLI is found, `remote/status` reads Tailscale whatever the
records say: `funnel_extra` and `engine_exposed` hold whoever set the handler.

**Identity** ([decision 0071](../DECISIONS.md#d0071)). An agent registers only once its owner
opted in: `identity/allow`, with the owner key over IPC, writes the identity registry's one call
into the ceiling of the agent's main wallet, and no other wallet's, read back, journaled and
announced as `ceiling/set` is; a ceiling that holds it already is left as it is (`changed: false`).
Once binference holds the agent's identity, a ceiling planned again for it leaves the call out
([decision 0335](../DECISIONS.md#d0335)). `identity/register` stores a
`registerIdentity` intent whose one step registers the agent in the ERC-8004 identity registry
the chain registry lists. Its registration file, stored on chain as a data URI, holds the agent's
name, `description` (at most 280 characters, the owner's words, none when absent), the
address of the wallet that registers it, its live main wallet on the registry's chain, and
binference's release version ([decision 0334](../DECISIONS.md#d0334)); its card shows every
field. Only the owner registers an identity: one the agent runtime or an MCP client proposes,
here or through `intent/propose`, fails `intent.owner_only`, storing nothing
([decision 0335](../DECISIONS.md#d0335)). A paper agent's ends `rejected_policy` with `paper_only`,
an agent that has a registration, or whose wallet the registry reads holding one, fails
`intent.identity_exists`, storing nothing, an agent with a registration that has not ended fails
`intent.identity_pending`, storing nothing, one whose agent's name or description holds a line
break or a hidden character fails `intent.identity_text`, storing nothing, and one whose main
wallet's ceiling lacks the call
ends `failed_check` with `identity_ceiling` before its card.

The owner's Telegram chat may run `config/change` past its `admin` scope for three patches alone,
one key each: `{ owner: { locale } }`, which a `/lang` button sends
([decision 0134](../DECISIONS.md#d0134)), and `{ telegram: { replies: { stream } } }` or
`{ telegram: { replies: { reasoning } } }`, which a `/replies` button sends
([decision 0377](../DECISIONS.md#d0377)). Any other setting changes from the chat through
`config/view` and `config/propose`, which it runs as the owner: the change waits for the owner's
tap on its card ([decision 0393](../DECISIONS.md#d0393)).

<a id="section-7-10"></a>

### 7.10 Binance Agents

Decided in [decision 0080](../DECISIONS.md#d0080).

| Operation                | Scope                               | Write | Local | Args → result                                                                 |
| ------------------------ | ----------------------------------- | ----- | ----- | ----------------------------------------------------------------------------- |
| `binanceAgent/list`      | `read`                              |       |       | → connected Binance agents with state (`running`, `paused`, `stopped`)        |
| `binanceAgent/connect`   | `admin`                             | ✓     | ✓     | `{ folder, label }` → the agent; installs its hooks                           |
| `binanceAgent/timeline`  | `read`                              |       |       | paging, `{ agent }` → trades: what, amount, price, order id, tx hash, outcome |
| `binanceAgent/setLimits` | `confirm` if stricter, else `admin` | ✓     |       | `{ agent, limits }` → limits                                                  |
| `binanceAgent/pause`     | `confirm`                           | ✓     |       | `{ agent }` → state (braking)                                                 |
| `binanceAgent/resume`    | `admin`                             | ✓     |       | `{ agent }` → state                                                           |
| `binanceAgent/stop`      | `confirm`                           | ✓     |       | `{ agent }` → state; disconnects (braking)                                    |
| `binanceAgent/record`    | `read`                              | ✓     |       | `{ agent, from, to }` → the verified track record, or a CSV file              |
| `binanceAgent/report`    | `agent`                             | ✓     |       | sent by the hooks over IPC: one trade or one refused call                     |

<a id="section-7-11"></a>

### 7.11 Shell

Decided in [decision 0378](../DECISIONS.md#d0378). Only the current agent runtime calls these. A
command runs in the owner's shell behind the command wall; every answer carries outside content.
They take no idempotency key, so no answer, and no command's output, is ever stored.

| Operation    | Scope   | Write | Local | Args → result                                                                                                                                                                                                                                                                                                               |
| ------------ | ------- | ----- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell/run`  | `agent` |       |       | `{ agent, command, folder?, waitMs?, background?, timeoutSeconds? }` → `ShellJobView`: `ended` when the command ended within `waitMs` (10 to 50,000 ms, 10,000 by default), else `running`; `background` answers at once; refused `shell.off`, `shell.no_wall`, `shell.folder_missing`                                      |
| `shell/job`  | `agent` |       |       | `{ agent, job, action: "poll" \| "stop", waitMs? }` → `ShellJobView` with the output printed since the last read; `stop` ends the command and everything it started; `shell.job_not_found` once it is gone                                                                                                                  |
| `file/read`  | `agent` |       |       | `{ agent, path, offset?, limit?, cursor? }` → a page of a text file, at most 2,000 lines and 10 KiB, with `next` (an `offset`, and a `cursor` inside a line longer than a page) when more remains, or `{ kind: "image", path }` for an image file ([decision 0386](../DECISIONS.md#d0386))                                  |
| `file/write` | `agent` |       |       | `{ agent, path, content }` → `{ path, changed, bytes }`: the file written whole, its folders made                                                                                                                                                                                                                           |
| `file/edit`  | `agent` |       |       | `{ agent, path, edits }` → `{ path, changed, bytes, replaced?, problem? }`; an edit that cannot be placed changes nothing and answers why in `problem`, naming the edit and the file's closest lines                                                                                                                        |
| `file/patch` | `agent` |       |       | `{ agent, input }` → `{ files, problem? }`: the files a patch changed, or why it changed nothing                                                                                                                                                                                                                            |
| `file/send`  | `agent` |       |       | `{ agent, turn, paths, caption }` → `{ files }`: sends the owner, in the chat of the turn, up to 10 files of at most 20 MiB on the engine's machine, read as `file/read` reads a path, and pushes them as `chat/files` ([decision 0400](../DECISIONS.md#d0400)); one that cannot be read refuses all with its `file.*` code |
| `file/fetch` | `read`  |       |       | `{ agent, file, offset? }` → `{ name, bytes, offset, data, next? }`: 512 KiB of a file the agent sent, by its id, read again where it is; `file.not_found` once the engine no longer holds the id                                                                                                                           |

`ShellJobView` is `{ job, status, command, folder, startedAt, endedAt?, exitCode?, signal?,
timedOut, stopped, output, outputCut }`. `output` keeps the newest 200,000 characters, seed
phrases and private key blocks masked; `outputCut` says earlier output was dropped. A finished
command is kept 30 minutes.

<a id="section-7-12"></a>

### 7.12 Browser

Decided in [decision 0401](../DECISIONS.md#d0401). Only the current agent runtime calls it. The
browser is binference's own, with its own profile in the state folder; every request it makes is
checked first, and every answer carries outside content. It takes no idempotency key, so no page
is ever stored.

| Operation     | Scope   | Write | Local | Args → result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------- | ----- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser/run` | `agent` |       |       | `{ agent, request }` → `BrowserView`; `request.action` is `status`, `start`, `stop`, `tabs`, `open`, `focus`, `close`, `navigate`, `snapshot`, `screenshot`, `text`, `console`, `pdf` or `act`, with `act.kind` `click`, `type`, `press`, `hover`, `select`, `fill`, `scrollIntoView`, `drag`, `wait`, `evaluate`, `resize` or `close`; every action but `status` and `stop` starts the browser; refused `browser.off`, `browser.not_found`, `browser.start_failed`, `browser.proxy_held`, `browser.address_refused`, `browser.tab_not_found`, `browser.evaluate_off` |

`BrowserView` is `{ running, headless?, tab?, tabs?, snapshot?, text?, cut?, console?, file?,
value?, problem? }`. `snapshot` is the page's accessibility tree with a ref (`e12`) on each element
an act names, at most 9,000 characters; `navigate` answers its interactive elements. `file` names a
screenshot or a PDF the engine saved under the workspace's `media/browser/<date>/`. `problem` says
why an action ran and failed, such as a ref no element holds now.

<a id="section-8"></a>

## 8. Shared shapes

<a id="section-8-1"></a>

### 8.1 Intent requests

Every request carries `agent`, an optional `wallet` (default: the agent's first wallet), and
`reason`: the agent's words, shown on the card as "agent says", escaped.

| `kind`             | Fields                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swap`             | `from: AssetRef`, `to: AssetRef`, `amount: { base } \| { percentBps }`, `maxSlippageBps?`                                                                                                                                                                                                   |
| `buy`              | `token: AssetRef`, `spend: Amount` (BNB or a stablecoin), `maxSlippageBps?`; curve or pool chosen by the engine                                                                                                                                                                             |
| `sell`             | `token: AssetRef`, `amount: { base } \| { percentBps }`, `receive?: AssetRef`, `maxSlippageBps?`                                                                                                                                                                                            |
| `send`             | `amount: Amount`, `to: { address } \| { name } \| { entry }` (below)                                                                                                                                                                                                                        |
| `revokeApproval`   | `token: AssetRef`, `spender: AccountRef`                                                                                                                                                                                                                                                    |
| `lend`             | Not served: lending left v1 ([decision 0296](../DECISIONS.md#d0296)). v1 keeps the shape, `action: supply \| withdraw \| borrow \| repay`, `venue`, `amount: Amount`, and the engine refuses it with `intent.kind_unavailable`, storing nothing                                             |
| `stake`            | `action: stake \| unstake \| claim`, `venue: stakehub \| lista`, `validator?`, `amount?: Amount` (below)                                                                                                                                                                                    |
| `bridge`           | `amount: Amount`, `toChain: ChainRef`, `to: { entry } \| { rescue: true }` ([decisions 0067](../DECISIONS.md#d0067) and [0297](../DECISIONS.md#d0297)); below                                                                                                                               |
| `cexOrder`         | `market`, `side`, `type: market \| limit`, `size`, `price?` (plugin)                                                                                                                                                                                                                        |
| `registerIdentity` | `description?` (created by `identity/register`, section 7.9)                                                                                                                                                                                                                                |
| `launchToken`      | `venue: flap \| fourmeme \| geniusfun \| brew`, `name`, `symbol`, `image` (an upload id), `description?`, `links?`, `pairWith: AssetRef`, `firstBuy?: Amount`, `venueOptions?` (each venue's own settings, such as a tax, validated by its plugin) ([decision 0082](../DECISIONS.md#d0082)) |

`buy` and `sell` name no venue: the engine picks the place, the token's launchpad curve or the
pools, by [spec 6, section 5](intent-states.md#section-5), and the quote names it (`place`). A
`sell` by `percentBps` sells that share of what the wallet holds of the token when the quote is
built, rounded down, never more than the wallet holds; `10000` sells all of it. `receive` defaults
to the curve's quote token on a curve, and to the chain's coin in the pools. A `launchToken` in
paper mode ends `rejected_policy` with `paper_only` (spec 6, section 4).

**Sends.** `to.address` is a CAIP-10 account on the wallet's chain, and `to.entry` an address
book entry on it; either must be the rescue address or a saved address, else the intent ends
`rejected_policy` with `unsaved_address` ([decision 0091](../DECISIONS.md#d0091)). `to.name` is a
`.bnb` name, resolved as `name/resolve` resolves it when the intent is proposed: its refusals end
the intent `failed_check` with `name_unresolved` or `name_contract`, and its address must be saved
as any other. The intent keeps the name and the address it resolved to (`IntentView.resolvedName`),
the card shows both, and the address book keeps only the address. A send's card is drawn from what
the engine resolved, never from the model's words.

**Stakes** ([decision 0296](../DECISIONS.md#d0296)). On `stakehub`, `validator` is the
validator's operator account and every action names it; on `lista` none does, and one that names
a validator, or an `unstake` there that names BNB, is refused with `intent.pool_venue`, whose
words say to propose it again without one and in slisBNB ([decision 0331](../DECISIONS.md#d0331)).
A `stake` names `amount` in the chain's coin; an `unstake` names it in BNB on `stakehub`, or
exactly that much slisBNB on `lista`, or leaves it out to unstake the whole stake
([decision 0327](../DECISIONS.md#d0327)); a `claim` names none and claims everything its venue
lets the wallet claim now, on `lista` the oldest request its queue released, and one that names an
amount is refused with `protocol.bad_args`. A stake
counts its USD value against the per-trade and 24-hour caps; an unstake and a claim count against
neither. Every staking move pays only the agent's own wallet. Spec 6 holds their checks and auto
mode.

**Bridges** ([decision 0297](../DECISIONS.md#d0297)). `toChain` is a destination chain the
registry lists; `to.entry` is an address book entry on `toChain` (an unknown entry is
`address.not_found`, one that is a wallet of the install `address.own_wallet`); `to.rescue` is
allowed only on a destination of the rescue address's own family, and without a rescue address is
`rescue.no_address`. Anything else is `protocol.bad_args`. The rescue address's code is read on the
wallet's chain and on `toChain` before its card: code on either ends the bridge `failed_check` with
`rescue_not_plain` ([decision 0318](../DECISIONS.md#d0318)). The wallet a bridge runs from follows
its routes ([decision 0319](../DECISIONS.md#d0319)): `intent.bridge_wallet_missing` and
`intent.bridge_wallet_only` refuse it before anything is stored. The engine takes the route with
the best minimum received, as `bridge/quote` orders them; its quote names the delivered token,
which may differ from the token sent. A bridge's `IntentView.delivery` follows it until the delivery or a refund is
read.

`rescue` intents are created only by `safety/rescue`, `unfreeze` intents only by `safety/unfreeze`
(`{ kind: "unfreeze", agent? }`), `autoOrder` intents only by `order/create`
(`{ kind: "autoOrder", order }`, [decision 0189](../DECISIONS.md#d0189)), `webhookRule` intents
only by `webhookRule/create` (`{ kind: "webhookRule", rule }`,
[decision 0299](../DECISIONS.md#d0299)), `configChange` intents only by `config/propose`
(`{ kind: "configChange", patch, reason? }`, always live, [decision 0393](../DECISIONS.md#d0393)),
and fill intents only by the engine for an auto order or webhook rule.

<a id="section-8-2"></a>

### 8.2 Auto order requests

`{ agent, wallet?, kind, token, side, size, spend?, trigger, worstPrice?, maxSlippageBps?, expiresAt?, maxFills? }`

`reason?` is the agent's words on why, as an intent request's `reason`: the order's card shows it
as what the agent says, escaped ([decision 0177](../DECISIONS.md#d0177)). The agent runtime always
sends one; another client may leave it out. An order that names no `expiresAt` ends its agent's
`orderExpiryDays` after it is made: `defaults.orders.expiryDays` (spec 2), 30 days, until
`limit/set` changes it. One that names an `expiresAt` further ahead than that is refused with
`order.expiry_limit` ([decision 0364](../DECISIONS.md#d0364)); a webhook rule keeps its own 30
days.

| `kind`       | `trigger`                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `limit`      | `{ price: usdMicros, direction: above \| below }`                                                                                                                                                |
| `takeProfit` | `{ price: usdMicros }`                                                                                                                                                                           |
| `stopLoss`   | `{ price: usdMicros }`                                                                                                                                                                           |
| `trailing`   | `{ distanceBps }`                                                                                                                                                                                |
| `dca`        | `{ cron, timezone?, count? }`: buys only, `count` times ([decision 0246](../DECISIONS.md#d0246))                                                                                                 |
| `copy`       | `{ leader: AccountRef, perBuyUsdMicros, dailyUsdMicros }`; sells mirror the leader's share ([ARCHITECTURE.md section 28](../ARCHITECTURE.md#section-28), [decision 0260](../DECISIONS.md#d0260)) |

**Copy orders** ([decision 0261](../DECISIONS.md#d0261)). A `copy` order copies every token its
leader trades on the leader's chain: its `token` is that chain's coin, its `side` is `buy`, its
`size` is `{ usdMicros }` equal to `perBuyUsdMicros`, at least $5, and `dailyUsdMicros` is at least
that; it names no `worstPrice`. Its fills are one per leader trade it copies, with no limit unless
it names `maxFills`. Each buy spends the least of `perBuyUsdMicros`, the agent's `copy.perBuyUsd`
and the leader's own buy, valued as the policy values it, of what it spends; a sale sells the leader's share of what the order bought of the token, never more
than the wallet holds ([decision 0260](../DECISIONS.md#d0260)).

`size` is `{ base }`, `{ usdMicros }` or `{ percentBps }`. Defaults come from the agent's limits
([ARCHITECTURE.md section 28](../ARCHITECTURE.md#section-28)): 30-day expiry, one fill for limit,
take-profit and stop-loss.

**Buy sizes** ([decision 0190](../DECISIONS.md#d0190)). `spend` names what a buy order spends: the
chain's coin or a token the registry lists on the token's chain (BNB or a stablecoin), never the
token it buys; absent, the chain's coin, which `order/create` fills in. A sell order names none. A
buy's `size` counts what it spends: `{ usdMicros }` that many dollars of it, priced at the fill;
`{ base }` that amount in its base units; `{ percentBps }` that share of the wallet's spendable
balance of it when the fill is quoted, rounded down. The spendable balance is the whole balance of
a token, and of the chain's coin what lies above the agent's gas reserve
([decision 0045](../DECISIONS.md#d0045)), never below zero. Every fill still passes the per-trade
and 24-hour caps, at its own value.

**Exit orders.** A `takeProfit`, a `stopLoss`, a `trailing` order, or a `limit` order with
`side: sell`, is an exit order of its position: its wallet, its token, and its mode, live or paper.
A sale by an exit order never sells more than the position holds. When one exit order's fill
empties the position, the position's other active exit orders end (spec 6, section 5).

<a id="section-8-3"></a>

### 8.3 Views

Each view is the stored record plus what a client needs to draw it. Responses that mention assets
carry `assets: Record<AssetRef, AssetInfo>` once, instead of repeating metadata.

- `AssetInfo`: `{ symbol, name, decimals, verified, onCurve?, logo? }`. `symbol` and `name` are set
  by whoever deployed the token; clients escape them ([rule 3](../ARCHITECTURE.md#rule-3)). An
  intent's or order card's token the registry does not list carries what its contract answered at
  the proposal, with `verified: false` ([decision 0199](../DECISIONS.md#d0199)). `order/list`,
  `portfolio/get` and `facts/get` carry the same for such a token, from the newest intent that
  stored it; a token no intent stored is left out, and clients show it by its address.
- `QuoteView`:
  `{ route: [{ venue, shareBps }], amountIn, expectedOut, minOut, priceImpactBps, gas: Amount, quotedAt, expiresAt, place?, poolFees? }`.
  `place`, on a `buy` or `sell` quote, is `{ kind: curve, launchpad }` or `{ kind: pools }`.
  `poolFees`, `[{ maker, feeBps }]`, is what the route's pool hooks keep, by who made their pools,
  which `expectedOut` already holds back ([decision 0215](../DECISIONS.md#d0215)).
- `RiskView`:
  `{ verdict: pass \| warn \| block, flags: [{ code, source }], buyTaxBps?, sellTaxBps?, liquidityUsdMicros?, insiders?: [AccountRef], onCurve, checkedAt }`;
  `insiders` are the wallets the token's launchpad favors over every other buyer, such as those its
  launch exempted from the launch-window tax, at most 50, the first it named
  ([decision 0213](../DECISIONS.md#d0213)).
- `CardView`: `{ card, version, opensAt, expiresAt, paper, outsideContent }`; its text is spec 4.
- `LiveFactsView`:
  `{ agent, at, timeZone, mode, frozen, approvalMode, sendLevel, balances?: [BalanceView], totalUsdMicros?, orders: [OrderView], spentTodayUsdMicros, perTradeUsdMicros, rollingDayUsdMicros, assets }`:
  the balances of the agent's mode, its active and paused orders (at most 50), and its outflows of
  the last 24 hours against the caps in effect.
- `IntentView`:
  `{ intent, agent, wallet, kind, state, request, quote?, risk?, simulation?, card?, outcome?, paper, outsideContent, createdAt, changedAt, assets, resolvedName?, delivery?, bridgeReceipt?, receipt? }`.
  `resolvedName` is `{ name, address, resolvedAt }` for a send by name. `delivery` is a bridge's
  `DeliveryView`; a change of it pushes `intent/changed`. `bridgeReceipt` is the `CardLineView`
  a live bridge's card ends with from its final deposit on (spec 4, section 3.9), which
  `intent/get` and `intent/list` give, its assets in `assets`. `receipt` is the `CardLineView` every
  copy of the intent's closed card ends with (spec 4, section 3.5;
  [decision 0346](../DECISIONS.md#d0346)): how it closed and what followed, as Telegram's copies
  show it, which `intent/get`, `intent/list`, `intent/confirm` and `intent/deny` give, its assets in
  `assets`; absent while the card is open. For a bridge it says what `bridgeReceipt` says, which
  the next version drops. `outcome` is
  `{ reason?, chain?, validator?, minStake?, readyAt?, txHashes?, executions? }`: `chain` names
  the chain a bridge's reason means, the chain it bridges to, as that reason's words show it; a
  staking move's reason names its `validator` (`{ account, name? }`, the name the venue's own),
  the venue's least stake `minStake` (an `Amount`) and `readyAt`, when the next part can be
  claimed, as its words show them ([decision 0327](../DECISIONS.md#d0327)).
- `StakingPositionView`:
  `{ wallet, venue, validator?, staked?: Amount, stakedValue?: Amount, unbonding: [{ amount, readyAt }], claimable: Amount, paper }`:
  `staked` in the venue's own receipt token (a validator's credit shares on StakeHub, slisBNB on
  Lista), `stakedValue` what it is worth in BNB now, `unbonding` what an unstake took out with when
  each part can be claimed, `claimable` what a claim would take now. `staked` and `stakedValue`
  are absent when the venue could not be read: the view shows the coin with no value and the
  totals leave it out, as a token with no price ([decision 0329](../DECISIONS.md#d0329)).
- `BridgeRouteView`:
  `{ venue, toChain, sentAsset, deliveredAsset, amountIn, expectedOut, minOut, fees: [{ kind: bridge | relayer | gas, amount }], etaSeconds, quotedAt, expiresAt }`: the network fee of the deposit is known only once it is built, so a quote leaves it out and the card shows it;
  `deliveredAsset` is a CAIP-19 asset of `toChain`, which may differ from `sentAsset`, and
  `expectedOut` and `minOut` are amounts of it.
- `DeliveryView`:
  `{ state: in_transit | late | delivered | refunded, toChain, recipient: AccountRef, deliveredAsset, minOut, received?: Amount, fillTx?, refundTx?, statusUrl?, sentAt, lateAt?, settledAt? }`:
  `in_transit` from the deposit's final block, `late` 2 hours after it, `delivered` only once the
  destination chain's read found the payment (`fillTx`, `received`), `refunded` once the source
  chain's read found the bridge paying the wallet back (`refundTx`). `statusUrl` is the venue's own
  page for the deposit.
- `PortfolioView`:
  `{ balances: [{ wallet, amount, usdMicros?, paper }], positions: [{ wallet, asset, quantity, costUsdMicros, realizedUsdMicros, unrealizedUsdMicros?, paper }], totalUsdMicros, paperTotalUsdMicros?, assets, staking?: [StakingPositionView], inTransit?: [{ intent, wallet, amount, usdMicros?, toChain, chainName?, recipient, sentAt, late }] }`.
  `chainName` names the destination chain as the bridge's card did, such as Base.
  A staked position counts once, at its `stakedValue`, its unbonding and claimable amounts beside
  it. A bridge in transit counts once, at the value its units left their position with, until its
  delivery read, when it leaves the agent, or its refund, which arrives back at its value
  ([decision 0297](../DECISIONS.md#d0297)).
  A staked position's receipt units are also a balance, valued at the venue's pool, and the
  unbonding and claimable coin counts at its price now ([decision 0329](../DECISIONS.md#d0329)).
  Live holdings come first, then paper ones. `totalUsdMicros` sums the live balances, unbonding
  coin and bridges in transit with a known value, never a paper one; `paperTotalUsdMicros` sums
  the paper ones beside it, absent when the view holds none. The two are never added together.
- `PnlView`:
  `{ positions: [{ asset, realizedUsdMicros, unrealizedUsdMicros? }], realizedUsdMicros, unrealizedUsdMicros?, paperPositions?, paperRealizedUsdMicros?, paperUnrealizedUsdMicros?, cards?: [PnlCardView], assets }`.
  The first three are live, the `paper` ones paper, never added together; an unrealized figure is
  absent where no price is known. `PnlCardView` is `{ asset, paper, closed, lines: [CardLineView] }`:
  a position's P&L card ([spec 4, section 3.7](cards-and-messages.md#section-3-7)) drawn by the
  engine, so every surface shows the same card with `cardLineText`
  ([decision 0243](../DECISIONS.md#d0243)).
- `LaunchView`:
  `{ chain, token: AssetRef, launchpad, creator: AccountRef, quoteToken: AssetRef, taxBps?, snipeTaxBps?, curveProgressBps?, graduated, insiders: [AccountRef], creatorLaunches30d, block, tx, launchedAt, assets }`:
  one token a launchpad created, from its create event; `curveProgressBps` and `graduated` as last
  read; `insiders` the wallets the launchpad or the risk step names as exempt or first holders;
  `creatorLaunches30d` the launches the engine recorded for the same creator in the 30 days before.
- `OrderView.endReason?` says why an `ended` order ended: `position_closed` for an exit order whose
  position another exit emptied. `OrderView.intent?` is the `autoOrder` intent that carries its
  card, `paper?` its mode and `outsideContent?` the proposing turn's mark; `state` may be `paused`
  while its agent is frozen ([decision 0189](../DECISIONS.md#d0189)). `AlertView` carries `wake`, `fires` and `expiresAt?` (section 8.4).
- `OrderView`, `AlertView`, `ScheduleView`, `WalletView`, `AgentView`, `LimitsView`: the stored
  fields of spec 3 with ids and times as section 1 sets. `WalletView.chainName` names the chain
  its `address` is on, such as BNB Smart Chain. `WalletView.role` is `launch` for a launch
  wallet, `WalletView.bridge` is `true` for a bridge wallet ([decision 0307](../DECISIONS.md#d0307)),
  and `wallet/list` sets `WalletView.extra` on a live launch or bridge wallet beyond the agent's
  first, as a rebuild may adopt ([decision 0218](../DECISIONS.md#d0218)). `agent/list` adds each agent's `defaultWallet`, `launchWallet` and `bridgeWallet` to its `AgentView`.

<a id="section-8-4"></a>

### 8.4 Alert conditions and wake-ups

An alert sends no transaction and opens no card. When it fires, the engine records it, pushes
`alert/fired`, and sends the owner its notice ([spec 4, section 4.3](cards-and-messages.md#section-4-3)).
With `wake: true`, it also starts a turn of the agent (below).

| `condition.kind` | Fields                                                                           | Fires                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `price`          | `asset`, `direction: above \| below`, `price: usdMicros`                         | Once, on the first watcher price at or past `price`; the alert is then `fired`                         |
| `wallet`         | `account: AccountRef`, `side?: buy \| sell`, `asset?: AssetRef`, `minUsdMicros?` | On each trade of the account the leader watcher reads that matches, until the alert is deleted or ends |
| `launch`         | `filters: LaunchFilter`                                                          | On each new launch that passes the filters, until the alert is deleted or ends                         |

`LaunchFilter` is
`{ launchpads?: [flap | geniusfun | brew], quoteTokens?: [AssetRef], maxTaxBps?, maxSnipeTaxBps?, minCurveProgressBps?, minLiquidityUsdMicros?, maxInsiders?, maxCreatorLaunches30d? }`;
every field given must hold, and an empty filter passes every launch. `launch/list` and
`market/scan` take the same filter. `fourmeme` joins the list with the plugin that reads its
launches.

- **Tracked wallets.** An install tracks at most 50 wallets: the leaders of its active copy orders
  and the accounts of its active wallet alerts, across every agent
  ([spec 3, section 2.6](database.md#section-2-6)), counting the leaders of copy orders that await
  their card. An `alert/create` or `order/create` that would track a 51st fails
  `wallet.track_limit`; one that names a wallet already tracked passes.
- **Ends.** An alert with `expiresAt` ends then, in the state `ended`; `wallet` and `launch` alerts default to 30 days,
  as auto orders do. A `price` alert has no default expiry.
- **`AlertFired`**, the data of `alert/fired`:
  `{ alert, agent, at, fired: { kind: price, asset, priceUsdMicros } | { kind: wallet, activity: ActivityItem } | { kind: launch, launch: LaunchView }, woke, wakeSkipped?, assets }`.
  `woke` says whether it started a turn; `wakeSkipped` counts the wake-ups of the agent the hourly
  limit held back that no notice told yet, on a fire that wakes the agent and whose notice goes
  out ([decision 0274](../DECISIONS.md#d0274)).
- **Wake-ups.** A fired alert with `wake` stores an `inbox/alertFired` message
  `{ alert: AlertView, fired, outsideContent }` in the write that records the fire
  ([spec 8, section 3.3](runtime.md#section-3-3)). `outsideContent` is always set: what fires an
  alert is a market's or another wallet's doing, so the turn it starts is marked
  ([decision 0245](../DECISIONS.md#d0245)).
- **Firing** ([decision 0245](../DECISIONS.md#d0245)). A price alert is judged at its level on each
  confirmed watcher price, never as a crossing, and its token is watched while it is active. Each
  fire is written under the alert's count of fires, so it fires once. The price watchers, the
  leader watcher and the launch feed hand the engine's alert firing what they read (`seePrice`,
  `seeTrade`, `seeLaunch`); a launch filter's bound on a value the feed did not read never passes.
  Before a wake-up is stored the engine skips it for an archived or frozen agent or a spent budget,
  and each fire is kept in `alert_fires` with what it did about its wake-up. An active alert whose
  expiry came ends within 10 seconds. Each alert sends at most five notices an hour; its later
  matches that hour are counted and told in one line (`notice.alertHeld`) when the hour ends, and
  `alert/fired` goes out for every fire. A fire for an archived agent ends its alert, unheard.
- **Limits on wake-ups.** At most 10 wake-ups an hour per agent, counted over the last 60 minutes.
  Past that, the alert still fires and notifies, but stores no inbox message; the count goes into
  `wakeSkipped` of the next fire that wakes the agent and whose notice goes out, past any fire whose
  notice its alert's five an hour hold. While a wake-up from a price or wallet alert
  waits in the agent inbox, untaken, a newer fire of the same alert replaces its data instead of
  adding a message; each fire of a launch alert stores its own, and the chat queue merges the
  waiting ones into one turn ([decision 0274](../DECISIONS.md#d0274)). The runtime skips a wake-up while the budget is spent or the agent is frozen
  ([spec 8, section 3.3](runtime.md#section-3-3)); the notice has gone out already.

<a id="section-9"></a>

## 9. Versions

- The protocol version is an integer, `1` for v1. `open.v` names the client's; the engine serves the
  current version and the previous one for one stable release, else `bye protocol.version`.
- Inside a version, changes are additive: new operations, new optional fields, new push kinds, new
  error codes. A removal or a change of meaning needs a new version.
- `engine/describe` lists each operation's `since` (the engine version that added it), so clients
  can check before calling.
- `engine/describe` returns JSON Schemas made from the zod schemas (`z.toJSONSchema`); the MCP
  server and docs use the same output.
- Notes on v1 for clients:
  - `PortfolioView.totalUsdMicros` is the live total only. The paper total is
    `paperTotalUsdMicros`, an optional field beside it, and a client never adds the two. A client
    that showed `totalUsdMicros` as the whole portfolio shows the live part of it.
  - `PnlView`'s `positions`, `realizedUsdMicros` and `unrealizedUsdMicros` are live. The paper P&L
    is in the optional `paperPositions`, `paperRealizedUsdMicros` and `paperUnrealizedUsdMicros`
    ([decision 0137](../DECISIONS.md#d0137)); an engine that sends none of them has no paper P&L
    to show.
  - `alert/list` may hold `wallet` and `launch` conditions beside `price` (section 8.4). A client
    that does not know a condition's kind shows the alert by its id and state.
  - `ScheduleView.state` has a new value, `ended`, beside `active` and `cancelled`: a one-time
    schedule after its run, or a cron schedule with no run in eight years. `ScheduleView.lastRun`
    is a new optional field: the last run's due time, time, `sent` or `skipped` and its reason
    (section 7.5). A client that meets a state it does not know treats the schedule as no longer
    active. `ScheduleView.outsideContent` is a new optional field, which the engine always sends:
    the schedule is marked, so its prompt may hold outside content.
  - An `AccountRef` may name a chain of another family: a saved address on Solana is
    `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:<base58>`. A client never assumes an address is hex,
    and shows one it cannot read as it came.
  - `LimitsView.minHealthFactorBps` holds no limit, since binference does not lend or borrow
    ([decision 0296](../DECISIONS.md#d0296)): the engine always answers `15000`, and a
    `limit/set` whose changes name it is `protocol.bad_args` and changes nothing. The next version
    drops the field.
  - `IntentView.receipt` is a new optional field, the line every copy of a closed card ends with;
    `IntentView.bridgeReceipt` stays beside it for older clients, and the next version drops it.
  - An intent's `kind` has new values, `webhookRule`, the card of a webhook rule, and
    `configChange`, the card of a setting change. A client that meets a kind it does not know
    shows the card's lines from `intent/card`.
  - `config/view` and `config/propose` are new operations, and so is `engine/restart`; `config/view`
    answers `hash`, and `config/propose` takes `baseHash` and `replacePaths`
    ([decision 0395](../DECISIONS.md#d0395)).
  - `turn/end` takes an optional `failedTool`, and `chat/turnEnded` carries it
    ([decision 0394](../DECISIONS.md#d0394)).
  - `IntentView.resolvedName`, `IntentView.delivery` and `IntentView.bridgeReceipt`, `PortfolioView.staking` and
    `PortfolioView.inTransit` with its `chainName`, `WebhookRuleView.ratePerMinute`, `lastAlertAt`, `intent` and
    `summary`, `webhookRule/list`'s `assets`, `address/list`'s `room`, `WalletView.chainName`, `AgentView.bridgeWallet` with `engine/status`'s `bridgeWallet`, `engine/status`'s `debugSignalOff`, and the `autoAsks` of `engine/status`'s agents, `approval/get` and `approval/set` are new optional
    fields.
  - `AlertView.state` has a new value, `ended`, beside `active`, `fired` and `deleted`: an alert
    whose `expiresAt` passed (section 8.4). It is a new value of an existing field, which this
    version allows as an addition. An alert in `ended` fires no more, like `fired` and `deleted`; a
    client that meets a state it does not know treats the alert as no longer active and shows the
    state's name as it came.

<a id="section-10"></a>

## 10. Errors

`error.code` is `<area>.<reason>`. `message` is English for developers and is never shown to the
owner: surfaces map `code` to an i18n message. `retryable` says whether the same call may succeed
later unchanged.

| Area         | Codes                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol`   | `not_open`, `bad_frame`, `unknown_op`, `bad_args`, `busy`, `too_large`, `key_reused`, `version`                                                                                                                                                                                                                                                                                                |
| `auth`       | `required`, `invalid`, `expired`, `revoked`, `origin`, `scope`, `local_only`, `device_only`                                                                                                                                                                                                                                                                                                    |
| `engine`     | `starting`, `stopping`, `locked`, `timeout`                                                                                                                                                                                                                                                                                                                                                    |
| `runtime`    | `unavailable`                                                                                                                                                                                                                                                                                                                                                                                  |
| `agent`      | `not_found`, `archived`, `frozen`, `paper_only`, `disclaimer`, `budget`, `file_missing`, `file_untrusted`                                                                                                                                                                                                                                                                                      |
| `question`   | `not_found`, `closed`                                                                                                                                                                                                                                                                                                                                                                          |
| `image`      | `not_found`, `too_large`, `format`, `unreadable`                                                                                                                                                                                                                                                                                                                                               |
| `alert`      | `not_found`, `too_many`                                                                                                                                                                                                                                                                                                                                                                        |
| `market`     | `no_data`, `source_down`, `no_launch_feed`                                                                                                                                                                                                                                                                                                                                                     |
| `wallet`     | `not_found`, `unfunded`, `bad_owner_key`, `custody_down`, `track_limit`, `launch_exists`, `no_launch_calls`, `bridge_exists`, `no_bridge_calls`, `ceiling_too_large`, `ceiling_bad_bridge`, `ceiling_uncapped`, `venue_not_run`                                                                                                                                                                |
| `address`    | `not_found`, `launch_wallet`, `bridge_wallet`, `venue_contract`, `not_wallet`, `malformed`, `other_chain`, `unknown_chain`, `chain_full`, `own_wallet`                                                                                                                                                                                                                                         |
| `rescue`     | `no_address`, `nothing_to_move`                                                                                                                                                                                                                                                                                                                                                                |
| `signer`     | `not_found`, `last_signer`, `own_key`                                                                                                                                                                                                                                                                                                                                                          |
| `intent`     | `not_found`, `wrong_state`, `expired`, `card_changed`, `not_yours`, `owner_only`, `launch_waiting`, `own_wallet_recipient`, `launch_recipient_needed`, `launch_recipient_unused`, `launch_wallet_missing`, `bridge_wallet_missing`, `bridge_wallet_only`, `extra_wallet`, `launch_picture_too_large`, `kind_unavailable`, `pool_venue`, `identity_exists`, `identity_pending`, `identity_text` |
| `order`      | `not_found`, `wrong_state`, `kind_unavailable`, `unpriced_token`, `live_fills_off`, `slippage_limit`, `expiry_limit`                                                                                                                                                                                                                                                                           |
| `schedule`   | `not_found`, `bad_when`, `too_many`                                                                                                                                                                                                                                                                                                                                                            |
| `webhook`    | `not_found`, `too_many`, `url_shown`                                                                                                                                                                                                                                                                                                                                                           |
| `note`       | `not_found`                                                                                                                                                                                                                                                                                                                                                                                    |
| `asset`      | `not_found`, `bad_address`, `unreadable`                                                                                                                                                                                                                                                                                                                                                       |
| `name`       | `not_found`, `resolver_down`, `contract`                                                                                                                                                                                                                                                                                                                                                       |
| `quote`      | `no_route`, `venue_down`                                                                                                                                                                                                                                                                                                                                                                       |
| `chain`      | `rpc_down`, `simulation_failed`                                                                                                                                                                                                                                                                                                                                                                |
| `limit`      | `needs_admin`, `over_ceiling`, `daily_cap`, `needs_launch_wallet`, `needs_bridge_wallet`, `bridge_ceiling`                                                                                                                                                                                                                                                                                     |
| `config`     | `invalid`, `secret_inline`                                                                                                                                                                                                                                                                                                                                                                     |
| `plugin`     | `not_found`, `hash_mismatch`, `review_needed`, `fetch_failed`, `provenance_failed`, `invalid`, `id_taken`, `disabled`, `call_failed`                                                                                                                                                                                                                                                           |
| `skill`      | `not_found`, `hash_mismatch`, `refused`, `invalid`, `name_taken`, `fetch_failed`                                                                                                                                                                                                                                                                                                               |
| `job`        | `not_found`                                                                                                                                                                                                                                                                                                                                                                                    |
| `backup`     | `no_owner_key`, `snapshot_failed`, `write_failed`, `check_failed`, `copy_failed`                                                                                                                                                                                                                                                                                                               |
| `update`     | `registry_unreachable`, `terminal_only`                                                                                                                                                                                                                                                                                                                                                        |
| `telegram`   | `not_running`, `unreachable`                                                                                                                                                                                                                                                                                                                                                                   |
| `remote`     | `tailscale_missing`, `logged_out`, `https_off`, `funnel_denied`, `funnel_port`, `port_taken`, `same_port`, `not_operator`, `not_applied`                                                                                                                                                                                                                                                       |
| `token`      | `not_found`                                                                                                                                                                                                                                                                                                                                                                                    |
| `shell`      | `off`, `no_wall`, `folder_missing`, `job_not_found`                                                                                                                                                                                                                                                                                                                                            |
| `file`       | `not_found`, `walled`, `outside_workspace`, `too_large`, `is_folder`, `binary`, `exists`, `unreadable`, `unwritable`, `no_match`, `many_matches`, `overlap`, `offset_past_end`, `bad_patch`                                                                                                                                                                                                    |
| `credential` | `not_found`, `closed`, `unavailable`                                                                                                                                                                                                                                                                                                                                                           |
| `browser`    | `off`, `not_found`, `start_failed`, `proxy_held`, `address_refused`, `tab_not_found`, `evaluate_off`                                                                                                                                                                                                                                                                                           |
| `internal`   | `error` (with a `details.ref` to find the log line)                                                                                                                                                                                                                                                                                                                                            |

Policy and risk refusals are intent states with reasons, not errors (section 7.4). Their reason
codes (`daily_cap`, `per_trade_cap`, `gas_reserve`, `slippage`, `price_impact`, `tax`,
`low_liquidity`, `venue_off`, `token_denied`, `send_level`, `frozen`, `outside_content_send`,
`honeypot`, `cannot_sell`, `sources_down`, `no_price`, `unsaved_address`, `validator_jailed`) are
listed with their states in spec 6.

<a id="section-11"></a>

## 11. MCP mapping

`binference mcp` is a stdio MCP server and a protocol client with `read` and `propose`. Its tools
carry the `binference_` prefix and map one to one onto operations:

| Tool                         | Operation         | Tool                       | Operation        |
| ---------------------------- | ----------------- | -------------------------- | ---------------- |
| `binference_agents`          | `agent/list`      | `binference_propose`       | `intent/propose` |
| `binference_token_search`    | `asset/search`    | `binference_intent_status` | `intent/get`     |
| `binference_portfolio`       | `portfolio/get`   | `binference_order_create`  | `order/create`   |
| `binference_token_info`      | `asset/get`       | `binference_order_cancel`  | `order/cancel`   |
| `binference_token_risk`      | `risk/check`      | `binference_alert_create`  | `alert/create`   |
| `binference_quote`           | `quote/get`       | `binference_ledger`        | `ledger/list`    |
| `binference_orders`          | `order/list`      | `binference_resolve_name`  | `name/resolve`   |
| `binference_staking_options` | `staking/options` | `binference_bridge_quote`  | `bridge/quote`   |
| `binference_addresses`       | `address/list`    | `binference_wallets`       | `wallet/list`    |

Each tool's input schema is the operation's args schema from `engine/describe`. A proposal answers
with the intent and "waiting for the owner's confirmation in Telegram or the console". A client
finds its ids with the first two: the agent and its wallet's chain with `binference_agents`, each
asset's id with `binference_token_search`, which reads only the engine's registry and the held
tokens and says when a symbol is ambiguous.

<a id="section-11-1"></a>

### 11.1 Setting up a client

`binference mcp setup --client <claude-code|codex>` sets an MCP client up over IPC with the CLI's
token ([decision 0154](../DECISIONS.md#d0154)), in this order:

1. **The skill passes `lintSkill`.** A bundled skill with a finding stops the setup before anything
   changes.
2. **A client token of its own.** The token in `auth/mcp-<client>.token` stays while it still signs
   in and has no expiry. Otherwise the CLI revokes the client's tokens (label `mcp-<client>`), makes
   a new `bnt_` secret, registers its SHA-256 with `token/register` (`kind: "mcp"`, `read` and
   `propose`) and writes the secret owner-only to that file. `--ttl <duration>` (`30m`, `12h`,
   `7d`, at most `90d`) always makes a new token, which expires that long after it is made
   ([decision 0159](../DECISIONS.md#d0159)).
3. **The MCP server entry**, named `binference`, which runs this binference's
   `mcp --client <client>` with `BINFERENCE_HOME` when set, and holds no secret. Claude Code: user
   scope, through `claude mcp add-json --scope user` when `claude` is on PATH, else the
   `mcpServers` of `.claude.json` in `CLAUDE_CONFIG_DIR` or the home folder. Codex: the
   `[mcp_servers.binference]` table of `config.toml` in `CODEX_HOME` or `~/.codex`, every other
   line kept; a server written another way leaves the file as it is.
4. **The bundled `binference-tools` skill**: `skills/binference-tools/` in `CLAUDE_CONFIG_DIR` or
   `~/.claude` for Claude Code, `~/.agents/skills/binference-tools/` for Codex.

Each step changes only what differs, so a second run changes nothing, and each prints whether it
made, updated or kept its part. `--dry-run` prints the changes and makes none. `--remove` removes
the entry and the skill, revokes the client's tokens and deletes the token file.

<a id="section-11-2"></a>

### 11.2 One session of a client

`binference mcp session --client <claude-code|codex> [--ttl <duration>] [-- <client args>]` starts
the client once with a token of its own ([decision 0159](../DECISIONS.md#d0159)):

1. **A token for the session.** The CLI makes a `bnt_` secret and registers its SHA-256 with
   `token/register` (label `mcp-<client>-session`, `kind: "mcp"`, `read` and `propose`) and an
   expiry: 1 hour, or `--ttl` (`30m`, `2h`, at most `24h`). Setup and session tokens never revoke
   each other.
2. **The client, the secret reaching only binference's server.** `binference mcp` signs in with
   `BINFERENCE_MCP_TOKEN` before any token file; the secret is never in an argument
   ([decision 0165](../DECISIONS.md#d0165)). Claude Code starts with
   `--strict-mcp-config --mcp-config <file>`, the file owner-only in the state folder's `tmp/` with
   only the `binference` server, whose `env` holds the variable; Claude Code's own environment
   never holds it, so its tools and hooks cannot read it there. Codex, which takes a server's
   literal values only in its config files or arguments, gets the variable in its environment and
   `-c` overrides of `mcp_servers.binference`, `env_vars = ["BINFERENCE_MCP_TOKEN"]` among them,
   and `shell_environment_policy.filters.BINFERENCE_MCP_TOKEN = "exclude"`, which keeps it out of
   the commands Codex's shell runs; its other servers stay. A `BINFERENCE_MCP_TOKEN` already in
   the CLI's environment is never passed on. The arguments after `--` follow.
3. **The end.** When the client exits, the CLI revokes the token and removes the config file. A
   `SIGTERM`, `SIGHUP` or `SIGBREAK` to the CLI is passed to the client first; a `SIGINT` is left
   to the client, which gets its own from the terminal. A fault in the CLI revokes the token too;
   when the CLI is killed, the expiry ends it.

`--print-config` registers the token and prints the config, the variable's value and the expiry,
starts nothing and revokes nothing.

<a id="section-12"></a>

## 12. Security checklist for this spec

- No connection is trusted for its address; every one authenticates.
- Browser connections pass the origin check; tokens are refused over WS.
- Confirming needs `confirm` and the card's current version.
- Looser limits, send levels, unfreeze and auto mode need `loosen`; exports, installs, saved
  addresses and the ceiling need `admin`, the IPC transport and the owner key.
- Secrets never appear in a reply or a push: tokens and webhook URLs are shown once at creation, and
  config shows secret sources by kind.
- Every write is idempotent and durable before its reply.
- Every limit in section 2 is enforced per connection.
- A browser push carries no amount, address or name, and a Confirm it leads to needs the device's
  signed connection.
