# Spec 1: the engine protocol

Status: accepted on 2026-10-06 ([decision 0090](../DECISIONS.md#d0090)), with
[decision 0088](../DECISIONS.md#d0088) and [decision 0089](../DECISIONS.md#d0089); custody
operations follow spec 5 ([decision 0085](../DECISIONS.md#d0085)); amended by
[decision 0104](../DECISIONS.md#d0104).

The engine serves one protocol to every client: the agent runtime, the console and Mini App, the CLI
and terminal chat, and the MCP server. The engine is the only server. Every other part of binference
is a client with scopes, and none of them can confirm a transaction unless its scopes say so.

<a id="section-1"></a>

## 1. Conventions

These follow [ENGINEERING.md section 24.1](../ENGINEERING.md#section-24-1) and hold everywhere
below.

| Thing          | Rule                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Encoding       | UTF-8 JSON, one object per WebSocket text message                                                       |
| Amounts        | `{ asset: AssetRef, base: string }`; `base` is a decimal string of base units (`"1500000000000000000"`) |
| USD            | `usdMicros: string`, a decimal string of micro-dollars (`"123450000"` is $123.45)                       |
| Rates          | Integers in basis points (`slippageBps: 50` is 0.5%)                                                    |
| Times          | Epoch milliseconds in UTC, as numbers, in fields ending `At`                                            |
| Ids            | UUIDv7 strings with a type prefix (section 1.1)                                                         |
| Chain ids      | CAIP-2 `ChainRef` (`eip155:56`), CAIP-10 `AccountRef`, CAIP-19 `AssetRef`                               |
| Optional       | A missing optional field is absent, never `null`                                                        |
| Unknown fields | Clients ignore fields they do not know; the engine rejects unknown fields in `args`                     |
| Paging         | Args `{ cursor?: string, limit?: number }` (default 50, at most 200); result `{ items, next?: string }` |

<a id="section-1-1"></a>

### 1.1 Id prefixes

| Prefix | Thing        | Prefix | Thing            |
| ------ | ------------ | ------ | ---------------- |
| `agt_` | agent        | `ord_` | auto order       |
| `wal_` | wallet       | `fil_` | order fill       |
| `int_` | intent       | `alr_` | alert            |
| `crd_` | card         | `whr_` | webhook rule     |
| `cnf_` | confirmation | `sch_` | schedule         |
| `tx_`  | transaction  | `ses_` | chat session     |
| `led_` | ledger entry | `trn_` | chat turn        |
| `adr_` | address book | `dev_` | console device   |
| `tok_` | client token | `con_` | connection       |
| `job_` | long job     | `bkp_` | backup           |
| `ntc_` | notice       | `plg_` | installed plugin |

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

<a id="section-2-1"></a>

### 2.1 HTTP endpoints

| Method and path        | What it does                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /`                | The console (static files)                                                                        |
| `GET /mini`            | The same console build in Mini App mode                                                           |
| `GET /ws`              | WebSocket upgrade                                                                                 |
| `POST /pair`           | Device pairing (section 4.2)                                                                      |
| `GET /file/:ticket`    | A single-use download (exports, reports, backups), valid 5 minutes                                |
| `POST /upload/:ticket` | A single-use upload of one image (raw body, at most 5 MiB), valid 2 minutes; answers `{ upload }` |
| `GET /health`          | `200 {"state":"ready"}`, `200 {"state":"locked"}` or `503 {"state":"starting"}`                   |

Browser requests to `/ws` and `/pair` must carry an `Origin` from the allowed list:
`http://127.0.0.1:<port>`, `http://localhost:<port>` and the Tailscale `serve` origin from config.
Any other origin fails with `auth.origin`.

<a id="section-2-2"></a>

### 2.2 The webhook listener

Inbound webhooks ([decision 0053](../DECISIONS.md#d0053)) use a separate listener, `127.0.0.1:7457`
by default, which Tailscale `funnel` publishes. It serves one route and nothing else:

- `POST /hook/:ruleId/:secret` with a JSON body of at most 16 KiB.
- `202` when the alert is accepted, `404` for an unknown rule or wrong secret (the same answer for
  both), `409` for a repeat, `429` above the rule's rate.
- A repeat is the same `id` field in the body, or the same body hash, within 10 minutes.
- The secret is 32 random bytes in base64url; only its SHA-256 is stored.

<a id="section-3"></a>

## 3. Frames

Every frame is a JSON object whose `t` field names its type.

| `t`         | Direction       | Shape                                                                                             |
| ----------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `open`      | client → engine | `{ t, v, client: { kind, version, locale? }, auth, resume? }`                                     |
| `challenge` | engine → client | `{ t, nonce }` (device auth only)                                                                 |
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
  engine starts it. `binference mcp` reads `~/.binference/auth/mcp.token`, created by
  `binference token create --for mcp` with `read` and `propose` only. `open.auth` is `{ token }`.
- **Console devices (WS only).**
  1. `binference console` prints a link `http://127.0.0.1:7456/#pair=<code>`; the code is single-use
     and valid 10 minutes.
  2. The browser makes an Ed25519 key pair with WebCrypto, marked non-extractable (ECDSA P-256 where
     Ed25519 is missing), and sends `POST /pair` with `{ code, publicKey, alg, label }`. The engine
     answers `{ deviceId }`.
  3. Each connection sends `open` with `auth: { device: deviceId }`. The engine answers `challenge`
     with 32 random bytes; the browser signs `"binference-device-v1\n" + nonce + "\n" + origin` and
     sends `prove`.
- **Telegram Mini App (WS only).** `open.auth` is `{ telegram: { initData } }`. The engine checks
  Telegram's signature with the owner's bot token, requires `auth_date` within 5 minutes and the
  owner's numeric user id, and refuses an `initData` hash it has seen in the last 24 hours.
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
  trace of it.
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

| Topic           | Scope   | Kinds                                                                                                                               |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `engine`        | `read`  | `engine/state`, `engine/updateAvailable`                                                                                            |
| `intent`        | `read`  | `intent/created`, `intent/changed`, `card/opened`, `card/closed`                                                                    |
| `order`         | `read`  | `order/created`, `order/changed`, `order/filled`, `order/skipped`                                                                   |
| `portfolio`     | `read`  | `portfolio/changed` (at most once per second per agent)                                                                             |
| `ledger`        | `read`  | `ledger/appended`                                                                                                                   |
| `alert`         | `read`  | `alert/fired`                                                                                                                       |
| `notice`        | `read`  | `notice/new`: the owner notifications of [ARCHITECTURE.md section 27](../ARCHITECTURE.md#section-27), as an i18n key and its values |
| `chat:<agt_id>` | `read`  | `chat/message`, `chat/status`, `chat/turnStarted`, `chat/turnEnded`                                                                 |
| `inbox`         | `agent` | `inbox/message`, `inbox/intentSettled`, `inbox/scheduleDue`, `inbox/resumeReport`                                                   |
| `config`        | `read`  | `config/changed` (a config journal entry)                                                                                           |
| `job`           | `read`  | `job/progress`, `job/done`, `job/failed`                                                                                            |
| `log`           | `admin` | `log/line` (after `log/follow`)                                                                                                     |

<a id="section-7"></a>

## 7. Operations

Operation names are `domain/action`: a singular domain, then a camelCase action. Columns: **scope**;
**write** (needs `key`); **local** (IPC only). Routed operations (marked R) are answered by the
agent runtime through the engine; when the runtime is down they fail with `runtime.unavailable`.

Long operations return `{ job }` at once and report through the `job` topic. File results are
`{ url, expiresAt }` for `GET /file/:ticket`.

<a id="section-7-1"></a>

### 7.1 Engine and safety

| Operation                   | Scope     | Write | Local | Args → result                                                                                             |
| --------------------------- | --------- | ----- | ----- | --------------------------------------------------------------------------------------------------------- |
| `engine/status`             | `read`    |       |       | → `{ state, version, protocol, frozen, agents: [{ id, mode, frozen }], health }`                          |
| `engine/describe`           | `read`    |       |       | → every operation with its scope, flags, `since` and JSON Schemas of args and result                      |
| `engine/stop`               | `admin`   | ✓     | ✓     | → `{}`; graceful shutdown ([ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24))                   |
| `engine/unlock`             | `admin`   | ✓     | ✓     | `{ passphrase? }` → `{}`; opens the agent key ([decision 0104](../DECISIONS.md#d0104))                    |
| `safety/status`             | `read`    |       |       | → `{ frozen, frozenAt?, rescueAddress?, pendingRescueAddress? }`                                          |
| `safety/freeze`             | `confirm` | ✓     |       | `{ agent?: agt_ }` (absent: every agent) → `{ frozenAt }`                                                 |
| `safety/unfreeze`           | `loosen`  | ✓     |       | `{ agent?: agt_ }` → `{}` ([rule 11](../ARCHITECTURE.md#rule-11), [decision 0089](../DECISIONS.md#d0089)) |
| `safety/rescue`             | `confirm` | ✓     |       | `{}` → `{ intent }`: one rescue intent for every agent wallet, awaiting a tap                             |
| `safety/setRescueAddress`   | `admin`   | ✓     |       | `{ address: AccountRef }` → `{ effectiveAt }` (24 hours later, [decision 0044](../DECISIONS.md#d0044))    |
| `safety/cancelRescueChange` | `confirm` | ✓     |       | `{}` → `{}`                                                                                               |

<a id="section-7-2"></a>

### 7.2 Agents and wallets

| Operation          | Scope                                       | Write | Local | Args → result                                                                           |
| ------------------ | ------------------------------------------- | ----- | ----- | --------------------------------------------------------------------------------------- |
| `agent/list`       | `read`                                      |       |       | paging → agents                                                                         |
| `agent/get`        | `read`                                      |       |       | `{ agent }` → `AgentView`                                                               |
| `agent/create`     | `admin`                                     | ✓     |       | `{ name, locale? }` → `AgentView` (starts in paper mode with the defaults table)        |
| `agent/rename`     | `admin`                                     | ✓     |       | `{ agent, name }` → `AgentView`                                                         |
| `agent/archive`    | `admin`                                     | ✓     |       | `{ agent }` → `{}` (orders cancelled, funds untouched)                                  |
| `agent/goLive`     | `admin`                                     | ✓     | ✓     | `{ agent }` → `AgentView`; fails `wallet.unfunded` or `agent.disclaimer` when not ready |
| `agent/goPaper`    | `confirm`                                   | ✓     |       | `{ agent }` → `AgentView` (braking)                                                     |
| `agent/readFile`   | `read`                                      |       |       | `{ agent, file }` → `{ text, updatedAt }`; `file` is one of the workspace files         |
| `agent/writeFile`  | `admin`                                     | ✓     |       | `{ agent, file, text }` → `{ updatedAt }`                                               |
| `wallet/list`      | `read`                                      |       |       | `{ agent? }` → wallets with addresses and labels                                        |
| `wallet/create`    | `admin`                                     | ✓     | ✓     | `{ agent, label, ownerKey }` → `WalletView` (a new Privy wallet, spec 5)                |
| `wallet/rename`    | `admin`                                     | ✓     |       | `{ wallet, label }` → `WalletView`                                                      |
| `wallet/exportKey` | `admin`                                     | ✓     | ✓     | `{ wallet, ownerKey }` → `{ privateKey }` (Privy's export, decrypted in the CLI)        |
| `ceiling/get`      | `read`                                      |       |       | `{ wallet }` → the wallet's Privy policy as `CeilingView`                               |
| `ceiling/set`      | `admin`                                     | ✓     | ✓     | `{ wallet, changes, ownerKey }` → `CeilingView` (spec 5, section 4)                     |
| `signer/revoke`    | `admin`                                     | ✓     | ✓     | `{ signer, ownerKey }` → `{}`: removes a machine's agent key from every wallet          |
| `approval/get`     | `read`                                      |       |       | `{ agent }` → `{ mode, changedAt }` ([decision 0088](../DECISIONS.md#d0088))            |
| `approval/set`     | `confirm` for `manual`, `loosen` for `auto` | ✓     |       | `{ agent, mode }` → `{ mode, changedAt }`; announced on every surface                   |

Workspace files: `RULES.md`, `PERSONA.md`, `OWNER.md`, `STRATEGY.md`, `NOTES.md`, `FIRST-CHAT.md`.

<a id="section-7-3"></a>

### 7.3 Market reads

| Operation              | Scope            | Args → result                                                                                                          |
| ---------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `portfolio/get`        | `read`           | `{ agent?, wallet? }` → balances, USD values, positions, P&L, paper flag                                               |
| `portfolio/pnl`        | `read`           | `{ agent, from, to }` → realized and unrealized P&L by position (average cost, [decision 0058](../DECISIONS.md#d0058)) |
| `portfolio/resetPaper` | `confirm`, write | `{ agent, balances? }` → the new paper portfolio (default 1 BNB and 500 USDT)                                          |
| `asset/get`            | `read`           | `{ asset }` → `AssetInfo` with risk when known                                                                         |
| `asset/search`         | `read`           | `{ chain, query }` → registry matches, or the pasted address when valid                                                |
| `name/resolve`         | `read`           | `{ name }` → `{ name, address, resolvedAt }` (`.bnb`, [decision 0071](../DECISIONS.md#d0071))                          |
| `quote/get`            | `read`           | a swap request (section 8.1) → `QuoteView`; creates no intent                                                          |
| `risk/check`           | `read`           | `{ asset }` → `RiskView`                                                                                               |

<a id="section-7-4"></a>

### 7.4 Intents

| Operation        | Scope                                                                   | Write | Args → result                                  |
| ---------------- | ----------------------------------------------------------------------- | ----- | ---------------------------------------------- |
| `intent/propose` | `propose`                                                               | ✓     | `IntentRequest` (section 8.1) → `IntentView`   |
| `intent/get`     | `read`                                                                  |       | `{ intent }` → `IntentView`                    |
| `intent/list`    | `read`                                                                  |       | paging, `{ agent?, state?, kind? }` → intents  |
| `intent/confirm` | `confirm`                                                               | ✓     | `{ intent, card, cardVersion }` → `IntentView` |
| `intent/deny`    | `confirm`                                                               | ✓     | `{ intent, card }` → `IntentView`              |
| `intent/cancel`  | `confirm`, or `propose` for the client's own intent before confirmation | ✓     | `{ intent }` → `IntentView`                    |

- `intent/propose` always answers with an intent when the args are valid. A refusal by policy or
  risk is an intent in a terminal state (`rejected_policy`, `risk_blocked`) with its reason, not a
  `fail`. This follows [ENGINEERING.md section 7](../ENGINEERING.md#section-7): expected outcomes
  are results.
- `intent/confirm` must name the card's current `cardVersion`. A re-quote that changes the terms
  opens a new card version ([rule 4](../ARCHITECTURE.md#rule-4)), and confirming an old version
  fails with `intent.card_changed`.
- Every state change pushes `intent/changed`; states and transitions are spec 6.

<a id="section-7-5"></a>

### 7.5 Auto orders, alerts, webhook rules and schedules

| Operation               | Scope     | Write | Local | Args → result                                                                                                                |
| ----------------------- | --------- | ----- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `order/create`          | `propose` | ✓     |       | `OrderRequest` (section 8.2) → `OrderView` awaiting its one card ([decision 0004](../DECISIONS.md#d0004))                    |
| `order/get`             | `read`    |       |       | `{ order }` → `OrderView` with fills                                                                                         |
| `order/list`            | `read`    |       |       | paging, `{ agent?, state? }` → orders                                                                                        |
| `order/cancel`          | `propose` | ✓     |       | `{ order }` → `OrderView` (braking: no card)                                                                                 |
| `alert/create`          | `propose` | ✓     |       | `{ agent, condition }` → `AlertView` (no transaction, no card)                                                               |
| `alert/list`            | `read`    |       |       | paging → alerts                                                                                                              |
| `alert/delete`          | `propose` | ✓     |       | `{ alert }` → `{}`                                                                                                           |
| `webhookRule/create`    | `admin`   | ✓     |       | `WebhookRuleRequest` → `{ rule, url }` awaiting its one card ([decision 0053](../DECISIONS.md#d0053)); the URL is shown once |
| `webhookRule/list`      | `read`    |       |       | → rules without secrets                                                                                                      |
| `webhookRule/delete`    | `confirm` | ✓     |       | `{ rule }` → `{}`                                                                                                            |
| `webhookRule/rotateUrl` | `admin`   | ✓     |       | `{ rule }` → `{ url }`                                                                                                       |
| `schedule/create`       | `propose` | ✓     |       | `{ agent, when: { cron, timezone? } \| { at }, prompt }` → `ScheduleView` ([decision 0049](../DECISIONS.md#d0049))           |
| `schedule/list`         | `read`    |       |       | `{ agent? }` → schedules                                                                                                     |
| `schedule/cancel`       | `propose` | ✓     |       | `{ schedule }` → `{}`                                                                                                        |

<a id="section-7-6"></a>

### 7.6 Limits, send levels and the address book

| Operation                 | Scope                                                | Write | Args → result                                                                                                            |
| ------------------------- | ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `limit/get`               | `read`                                               |       | `{ agent }` → `LimitsView` ([ARCHITECTURE.md section 28](../ARCHITECTURE.md#section-28))                                 |
| `limit/set`               | `confirm` if every change is stricter, else `loosen` | ✓     | `{ agent, changes }` → `LimitsView`; never past the ceiling                                                              |
| `sendLevel/get`           | `read`                                               |       | `{ agent }` → `{ level, pending? }`                                                                                      |
| `sendLevel/set`           | `confirm` if stricter, else `loosen`                 | ✓     | `{ agent, level }` → `{ level, pending? }`; looser waits 24 hours                                                        |
| `sendLevel/cancelPending` | `confirm`                                            | ✓     | `{ agent }` → `{ level }`                                                                                                |
| `address/list`            | `read`                                               |       | `{ agent }` → entries with `usableAt`                                                                                    |
| `address/add`             | `admin`, local                                       | ✓     | `{ agent, chain, address, label, ownerKey }` → entry; also saved in the ceiling ([decision 0091](../DECISIONS.md#d0091)) |
| `address/remove`          | `confirm`                                            | ✓     | `{ entry }` → `{}`                                                                                                       |

The engine decides what is stricter: a lower cap, a lower slippage, a smaller allow list, a larger
deny list, a higher health factor, a higher send level, a larger gas reserve.

<a id="section-7-7"></a>

### 7.7 Chat, notes and usage

| Operation       | Scope                  | Write | Args → result                                                                                         |
| --------------- | ---------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `chat/post`     | `chat`                 | ✓     | `{ agent, text, images? }` → `{ session, turn }`                                                      |
| `chat/messages` | `read` (R)             |       | `{ agent, session?, cursor?, limit? }` → messages                                                     |
| `chat/stop`     | `chat`                 | ✓     | `{ agent }` → `{}`: ends the running turn; confirmed transactions are untouched                       |
| `chat/clear`    | `chat`                 | ✓     | `{ agent }` → `{ session }`: starts a new session (`/clear`)                                          |
| `turn/say`      | `agent`                | ✓     | `{ agent, session, turn, text, final }` → `{}`; drafts are edited in place until `final`              |
| `turn/status`   | `agent`                |       | `{ agent, turn, statusKey, values? }` → `{}`                                                          |
| `turn/end`      | `agent`                | ✓     | `{ agent, turn, outcome }` → `{}`                                                                     |
| `usage/record`  | `agent`                | ✓     | `{ agent, turn, model, inputTokens, outputTokens, cachedTokens, usdMicros }` → `{ budgetLeftMicros }` |
| `usage/get`     | `read`                 |       | `{ agent?, from, to }` → spend by day and model, and the budget                                       |
| `notes/search`  | `read` (R)             |       | `{ agent, query, limit? }` → notes with their origin label                                            |
| `notes/list`    | `read` (R)             |       | `{ agent, cursor?, limit? }` → notes                                                                  |
| `notes/write`   | `agent` or `admin` (R) | ✓     | `{ agent, text, origin }` → note; `origin` is set by the engine from the caller                       |
| `notes/delete`  | `admin` (R)            | ✓     | `{ note }` → `{}`                                                                                     |

`images` are upload ids from `upload/start` (section 7.9): at most 4 per message, each a PNG, JPEG
or WebP of at most 5 MiB. A message with images marks the turn as outside content
([rule 13](../ARCHITECTURE.md#rule-13)). Telegram images reach the engine through Telegram and need
no upload.

<a id="section-7-8"></a>

### 7.8 Models, plugins and skills

| Operation        | Scope     | Write | Local | Args → result                                               |
| ---------------- | --------- | ----- | ----- | ----------------------------------------------------------- |
| `model/list`     | `read`    |       |       | → configured models by role, with prices when known         |
| `model/set`      | `confirm` | ✓     |       | `{ agent, role, model }` → the agent's models (`/ai`)       |
| `plugin/list`    | `read`    |       |       | → installed plugins, tiers, permissions, state              |
| `plugin/add`     | `admin`   | ✓     | ✓     | `{ source, hash }` → `{ job }`; asks for permission review  |
| `plugin/enable`  | `admin`   | ✓     |       | `{ plugin }` → plugin                                       |
| `plugin/disable` | `confirm` | ✓     |       | `{ plugin }` → plugin (braking)                             |
| `plugin/remove`  | `admin`   | ✓     |       | `{ plugin }` → `{}`                                         |
| `skill/list`     | `read`    |       |       | `{ agent? }` → skills                                       |
| `skill/add`      | `admin`   | ✓     | ✓     | `{ source, hash }` → `{ job }`; the install lint runs first |
| `skill/remove`   | `admin`   | ✓     |       | `{ skill }` → `{}`                                          |

<a id="section-7-9"></a>

### 7.9 Settings, ledger and operations

| Operation           | Scope                      | Write | Local | Args → result                                                                      |
| ------------------- | -------------------------- | ----- | ----- | ---------------------------------------------------------------------------------- |
| `config/read`       | `admin`                    |       |       | → the config with every secret source shown as its kind only                       |
| `config/change`     | `admin`                    | ✓     |       | `{ patch, reason? }` → `{ config, restartNeeded }`; journaled and announced        |
| `config/history`    | `read`                     |       |       | paging → journal entries                                                           |
| `ledger/list`       | `read`                     |       |       | paging, `{ agent?, from?, to? }` → entries with their hashes                       |
| `ledger/export`     | `read`                     | ✓     |       | `{ agent?, from?, to?, mode? }` → file (CSV) of `live` (default) or `paper` fills  |
| `device/list`       | `admin`                    |       |       | → devices                                                                          |
| `device/revoke`     | `confirm`                  | ✓     |       | `{ device }` → `{}`                                                                |
| `token/list`        | `admin`                    |       |       | → tokens without secrets                                                           |
| `token/create`      | `admin`                    | ✓     | ✓     | `{ label, scopes }` → `{ token }`, shown once                                      |
| `token/revoke`      | `confirm`                  | ✓     |       | `{ token }` → `{}`                                                                 |
| `backup/list`       | `read`                     |       |       | → backups                                                                          |
| `backup/create`     | `admin`                    | ✓     |       | `{ copyTo? }` → `{ job }`                                                          |
| `backup/restore`    | `admin`                    | ✓     | ✓     | `{ backup }` → `{ job }`; the engine restarts                                      |
| `update/check`      | `read`                     |       |       | → `{ current, latest?, channel, notes? }`                                          |
| `update/apply`      | `admin`                    | ✓     | ✓     | `{ version? }` → `{ job }`                                                         |
| `check/run`         | `read`; `admin` with `fix` | ✓     |       | `{ fix?, only? }` → `{ job }`; findings carry stable check ids                     |
| `report/create`     | `admin`                    | ✓     |       | `{}` → `{ job }`, then a file (the redacted support bundle)                        |
| `log/follow`        | `admin`                    |       |       | `{ level? }` → `{}`; lines arrive on topic `log`                                   |
| `log/unfollow`      | `admin`                    |       |       | `{}` → `{}`                                                                        |
| `remote/status`     | `read`                     |       |       | → Tailscale state, the Mini App and webhook URLs                                   |
| `remote/enable`     | `admin`                    | ✓     | ✓     | `{ mini?, webhooks? }` → `{ job }`                                                 |
| `remote/disable`    | `confirm`                  | ✓     |       | `{}` → `{}` (braking)                                                              |
| `identity/get`      | `read`                     |       |       | `{ agent }` → the ERC-8004 registration, if any                                    |
| `identity/register` | `propose`                  | ✓     |       | `{ agent }` → `IntentView` awaiting a tap ([decision 0071](../DECISIONS.md#d0071)) |
| `cex/status`        | `read`                     |       |       | → the Binance connection state                                                     |
| `cex/connect`       | `admin`                    | ✓     | ✓     | `{}` → `{ authorizeUrl }`; the OAuth flow returns to `127.0.0.1`                   |
| `cex/disconnect`    | `confirm`                  | ✓     |       | `{}` → `{}`                                                                        |
| `upload/start`      | `chat`                     |       |       | `{ contentType, bytes }` → `{ url, expiresAt }` for `POST /upload/:ticket`         |
| `push/subscribe`    | any                        |       |       | `{ topics }` → `{ seqs, resync? }`                                                 |
| `push/unsubscribe`  | any                        |       |       | `{ topics }` → `{}`                                                                |

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
| `send`             | `amount: Amount`, `to: { address } \| { name } \| { entry }`                                                                                                                                                                                                                                |
| `revokeApproval`   | `token: AssetRef`, `spender: AccountRef`                                                                                                                                                                                                                                                    |
| `lend`             | `action: supply \| withdraw \| borrow \| repay`, `venue`, `amount: Amount`                                                                                                                                                                                                                  |
| `stake`            | `action: stake \| unstake \| claim`, `venue: stakehub \| slisbnb`, `validator?`, `amount?: Amount`                                                                                                                                                                                          |
| `bridge`           | `amount: Amount`, `toChain: ChainRef`, `to: { entry } \| { rescue: true }` ([decision 0067](../DECISIONS.md#d0067))                                                                                                                                                                         |
| `cexOrder`         | `market`, `side`, `type: market \| limit`, `size`, `price?` (plugin)                                                                                                                                                                                                                        |
| `registerIdentity` | (none beyond `agent`)                                                                                                                                                                                                                                                                       |
| `launchToken`      | `venue: flap \| fourmeme \| geniusfun \| brew`, `name`, `symbol`, `image` (an upload id), `description?`, `links?`, `pairWith: AssetRef`, `firstBuy?: Amount`, `venueOptions?` (each venue's own settings, such as a tax, validated by its plugin) ([decision 0082](../DECISIONS.md#d0082)) |

`rescue` intents are created only by `safety/rescue`, and fill intents only by the engine for an
auto order or webhook rule.

<a id="section-8-2"></a>

### 8.2 Auto order requests

`{ agent, wallet?, kind, token, side, size, trigger, worstPrice?, maxSlippageBps?, expiresAt?, maxFills? }`

| `kind`       | `trigger`                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`      | `{ price: usdMicros, direction: above \| below }`                                                                                                        |
| `takeProfit` | `{ price: usdMicros }`                                                                                                                                   |
| `stopLoss`   | `{ price: usdMicros }`                                                                                                                                   |
| `trailing`   | `{ distanceBps }`                                                                                                                                        |
| `dca`        | `{ cron, timezone?, count? }`                                                                                                                            |
| `copy`       | `{ leader: AccountRef, perBuyUsdMicros, dailyUsdMicros }`; sells mirror the leader's share ([ARCHITECTURE.md section 28](../ARCHITECTURE.md#section-28)) |

`size` is `{ base }`, `{ usdMicros }` or `{ percentBps }`. Defaults come from the agent's limits
([ARCHITECTURE.md section 28](../ARCHITECTURE.md#section-28)): 30-day expiry, one fill for limit,
take-profit and stop-loss.

<a id="section-8-3"></a>

### 8.3 Views

Each view is the stored record plus what a client needs to draw it. Responses that mention assets
carry `assets: Record<AssetRef, AssetInfo>` once, instead of repeating metadata.

- `AssetInfo`: `{ symbol, name, decimals, verified, onCurve?, logo? }`. `symbol` and `name` are set
  by whoever deployed the token; clients escape them ([rule 3](../ARCHITECTURE.md#rule-3)).
- `QuoteView`:
  `{ route: [{ venue, shareBps }], amountIn, expectedOut, minOut, priceImpactBps, gas: Amount, quotedAt, expiresAt }`.
- `RiskView`:
  `{ verdict: pass \| warn \| block, flags: [{ code, source }], buyTaxBps?, sellTaxBps?, liquidityUsdMicros?, onCurve, checkedAt }`.
- `CardView`: `{ card, version, opensAt, expiresAt, paper, outsideContent }`; its text is spec 4.
- `IntentView`:
  `{ intent, agent, wallet, kind, state, request, quote?, risk?, simulation?, card?, outcome?, paper, outsideContent, createdAt, changedAt, assets }`.
- `OrderView`, `AlertView`, `ScheduleView`, `WalletView`, `AgentView`, `LimitsView`: the stored
  fields of spec 3 with ids and times as section 1 sets.

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

<a id="section-10"></a>

## 10. Errors

`error.code` is `<area>.<reason>`. `message` is English for developers and is never shown to the
owner: surfaces map `code` to an i18n message. `retryable` says whether the same call may succeed
later unchanged.

| Area       | Codes                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `protocol` | `not_open`, `bad_frame`, `unknown_op`, `bad_args`, `busy`, `too_large`, `key_reused`, `version` |
| `auth`     | `required`, `invalid`, `expired`, `revoked`, `origin`, `scope`, `local_only`                    |
| `engine`   | `starting`, `stopping`, `locked`, `timeout`                                                     |
| `runtime`  | `unavailable`                                                                                   |
| `agent`    | `not_found`, `archived`, `frozen`, `paper_only`, `disclaimer`                                   |
| `wallet`   | `not_found`, `unfunded`, `bad_owner_key`, `custody_down`                                        |
| `intent`   | `not_found`, `wrong_state`, `expired`, `card_changed`, `not_yours`                              |
| `order`    | `not_found`, `wrong_state`                                                                      |
| `asset`    | `not_found`, `bad_address`                                                                      |
| `name`     | `not_found`, `resolver_down`                                                                    |
| `quote`    | `no_route`, `venue_down`                                                                        |
| `chain`    | `rpc_down`, `simulation_failed`                                                                 |
| `limit`    | `needs_admin`, `over_ceiling`                                                                   |
| `config`   | `invalid`, `secret_inline`                                                                      |
| `plugin`   | `not_found`, `hash_mismatch`, `review_needed`                                                   |
| `job`      | `not_found`                                                                                     |
| `internal` | `error` (with a `details.ref` to find the log line)                                             |

Policy and risk refusals are intent states with reasons, not errors (section 7.4). Their reason
codes (`daily_cap`, `per_trade_cap`, `gas_reserve`, `slippage`, `price_impact`, `tax`,
`low_liquidity`, `venue_off`, `token_denied`, `send_level`, `frozen`, `outside_content_send`,
`honeypot`, `cannot_sell`, `sources_down`, `no_price`) are listed with their states in spec 6.

<a id="section-11"></a>

## 11. MCP mapping

`binference mcp` is a stdio MCP server and a protocol client with `read` and `propose`. Its tools
carry the `binference_` prefix and map one to one onto operations:

| Tool                      | Operation       | Tool                       | Operation        |
| ------------------------- | --------------- | -------------------------- | ---------------- |
| `binference_portfolio`    | `portfolio/get` | `binference_propose`       | `intent/propose` |
| `binference_token_info`   | `asset/get`     | `binference_intent_status` | `intent/get`     |
| `binference_token_risk`   | `risk/check`    | `binference_order_create`  | `order/create`   |
| `binference_quote`        | `quote/get`     | `binference_order_cancel`  | `order/cancel`   |
| `binference_orders`       | `order/list`    | `binference_alert_create`  | `alert/create`   |
| `binference_resolve_name` | `name/resolve`  | `binference_ledger`        | `ledger/list`    |

Each tool's input schema is the operation's args schema from `engine/describe`. A proposal answers
with the intent and "waiting for the owner's confirmation in Telegram or the console".

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
