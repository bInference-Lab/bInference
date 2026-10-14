# Spec 5: custody, keys, signing and backups

Status: accepted on 2026-10-06 ([decision 0097](../DECISIONS.md#d0097)), amended by decisions
[0103](../DECISIONS.md#d0103), [0116](../DECISIONS.md#d0116), [0117](../DECISIONS.md#d0117),
[0119](../DECISIONS.md#d0119), [0148](../DECISIONS.md#d0148), [0149](../DECISIONS.md#d0149), [0210](../DECISIONS.md#d0210), [0211](../DECISIONS.md#d0211) and [0217](../DECISIONS.md#d0217). It follows Privy custody (decisions
[0085](../DECISIONS.md#d0085), [0087](../DECISIONS.md#d0087) and [0091](../DECISIONS.md#d0091)).

<a id="section-1"></a>

## 1. The model

Every agent wallet is a Privy server wallet. No machine running binference holds a wallet's private
key. Three keys decide what happens to a wallet:

| Key    | Self-hosted                                                                | Cloud                                                      | Can do                                                                                                           |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Owner  | The **owner key** (P-256), shown once at `init`, kept offline by the owner | The user's Privy account, through their bInference sign-in | Own the wallet and its policy: raise the ceiling, save send addresses, export, attach a machine, remove a signer |
| Signer | The **agent key** (P-256), only in the signer process                      | Our signer service's key, in KMS                           | Ask Privy to sign a transaction, inside the policy only                                                          |
| App    | The owner's **Privy app secret**, only in the engine                       | Our app secret, only in the signer service                 | Authenticate API calls; signs nothing by itself                                                                  |

A wallet is owned by the owner (a key quorum holding the owner key's public half, or the Privy
user). The signer is an added signer bound to one policy, the **ceiling** (section 4). Privy refuses
any signature outside the policy, whatever the machine asks.

<a id="section-2"></a>

## 2. Setting up (self-hosted, `binference init`)

1. **Privy app.** The owner creates a Privy app (init prints the steps and the dashboard link),
   turns on server wallets for Ethereum, and pastes the app id and app secret. Init checks both with
   one read call and stores the secret through a secret source (spec 2, section 5).
2. **Owner key.** Init makes a P-256 key pair with the OS CSPRNG and shows the private half once, in
   the terminal only, as a code: `bnok1` followed by the key in base32, in groups of five, with a
   4-byte checksum so a typo is caught. The owner types back its last 6 characters. Init keeps only
   the public half (`custody.privy.ownerKeyPublic`) and forgets the private half when it exits.
   With nobody at a terminal (`--yes`, `--json`, a container or a service), init never makes an
   owner key and never prints a code: it takes the public half from `--owner-key-public`, which
   `binference owner-key create` made on a machine with a terminal, showing the code there with
   the same check-back, and is refused without it
   ([decision 0148](../DECISIONS.md#d0148)).
3. **Agent key.** Init makes a second P-256 key pair for this machine and stores the private half
   through the unlock mode (section 3).
4. **On Privy, with the app secret:** a key quorum for the owner key, a key quorum for the agent
   key, the policy (section 4), and the first agent wallet, owned by the owner quorum, with the
   agent quorum as its signer bound to the policy. Privy's create calls take no authorization
   signature; it asks the owner's signature for every later change to a wallet, a policy or a key
   quorum, and the wallet's signers' for its RPC
   ([authorization signatures](https://docs.privy.io/api-reference/authorization-signatures),
   [create a wallet](https://docs.privy.io/api-reference/wallets/create)).
5. Init reads the wallet back from Privy and refuses to finish unless the owner, the signer and the
   policy are exactly what it asked for.

More wallets (`binference wallet create`, and `--launch` for the agent's launch wallet, section 4)
and policy changes need the owner key again: the CLI asks for the code, uses it for that one
request, and forgets it.

**Cloud** does the same through binference.io: the user signs in, Privy's own window asks their
consent, the wallet is made in their Privy account with our signer service under the policy
([ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)).

<a id="section-3"></a>

## 3. The agent key and the app secret at rest

Decided in [decision 0065](../DECISIONS.md#d0065) and [decision 0103](../DECISIONS.md#d0103).

| `engine.unlock.mode` | Where the agent key and the app secret live                                                                                                                                      | Default when              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `keychain`           | The OS keychain: service `binference`, accounts `agent-key` and `privy-app-secret`                                                                                               | A desktop session exists  |
| `file`               | `~/.binference/keys/`, readable only by the service user (`0400`; an owner-only ACL on Windows), or the systemd credentials `binference-agent-key` and `binference-privy-secret` | Headless Linux and Docker |
| `command`            | Secret sources `{ fromCommand: [...] }` (1Password, Vault, pass)                                                                                                                 | Never by default          |
| `manual`             | The agent key in an encrypted file (below), opened by `binference unlock` over IPC after each start                                                                              | Never by default          |

In the `file` mode, a systemd unit passes its credentials in the folder `CREDENTIALS_DIRECTORY`
names. Each credential the unit passes wins over its file in `keys/`, entry by entry; the app
secret falls back to `custody.privy.appSecret`. No other mode reads credentials.

The `manual` file, `~/.binference/keys/agent-key.json`, owner-only:

```json5
{
  format: "binference-agent-key",
  version: 1,
  kdf: "scrypt",
  kdfParams: { n: 131072, r: 8, p: 1, dkLen: 32, salt: "<32 bytes, base64>" },
  cipher: "aes-256-gcm",
  iv: "<12 bytes, base64>",
  aad: "binference-agent-key-v1:<install id>",
  ciphertext: "<base64>",
  tag: "<16 bytes, base64>",
}
```

It is written to a temporary file in the same folder, synced, then renamed over the old one.

**The browser push key** ([decision 0158](../DECISIONS.md#d0158)): `keys/web-push-vapid` holds the
VAPID private key (P-256, PKCS #8 in base64url), owner-only, in every unlock mode; never in
`config.json5` or a database. `binference init` makes it, and the engine makes it at start when it
is missing, as on a new machine, whose copy leaves `keys/` behind; browsers subscribed to the old
key then subscribe again. An entry the engine cannot read leaves it without browser push, logged as
`web_push.key_unreadable`, and never stops a start.

Once both secrets open, Privy checks the app with one read and the signer starts with the agent
key, which must answer the public half the wallets name as their signer; only then does the engine
unlock. A failure there runs the engine locked too, never stops it: `app_secret_rejected` when
Privy refuses the app, `custody_unreachable` when Privy does not answer, `signer_failed` when the
signer does not start or holds another key ([decision 0117](../DECISIONS.md#d0117)), and
`signer_revoked` when a live wallet on Privy no longer lists this machine's agent key as its
signer, which `binference unlock` does not clear; such an engine leaves the owner's bot alone
([decision 0140](../DECISIONS.md#d0140)). A signer that
stops later locks the engine again with `notice.signerStopped`. `binference unlock` runs the whole
step again. After a start that found Privy out of reach, the engine retries the step by itself, up
to five more times within five minutes, each wait a random share of 10, 20, 40, 80 and 160
seconds; once they are spent it stays locked with `notice.privyUnreachable`
([decision 0119](../DECISIONS.md#d0119)).

While locked, the engine answers reads, refuses signing with `engine.locked`, and auto orders, auto
mode and webhook rules wait. A Confirm of a live intent fails with `engine.locked` and changes
nothing: its card stays open, so the owner confirms again once unlocked. Paper intents and Cancel
work as ever, and auto mode opens a card for a live intent (`autoAsks.locked`, spec 4). A notice
tells the owner on every surface. `binference check` warns in
`file` mode: a copy of the disk plus that folder lets someone sign inside the ceiling until the
owner removes the agent key.

<a id="section-4"></a>

## 4. The ceiling: each wallet's Privy policy

The policy is the second wall ([rule 18](../ARCHITECTURE.md#rule-18)). It allows only:

1. **Chain 56** (BSC), and later each chain the owner enables.
2. **Venue calls** ([decision 0149](../DECISIONS.md#d0149)): each function an enabled venue
   declares its trades call, matched by `function_name` with its JSON ABI, on the contracts that
   declare it, with a native value at most the per-transaction cap (`defaults.ceiling.perTxBnb`, 1
   BNB by default, [decision 0094](../DECISIONS.md#d0094)). An input the venue pins, such as
   `dagSwapTo.receiver` on OKX's router, must be the wallet itself. Each call holds only while the
   native coin the wallets sent in the last 24 hours stays within the chain's cap. No rule names an
   executor, a token or a Permit2.
3. **Approvals:** `approve(spender, amount)` on any token, only when `spender` is a contract an
   enabled venue declares as its spender, and only while each capped token's approvals in the last
   24 hours stay within its cap; never `setApprovalForAll`.
4. **Sends** ([decision 0091](../DECISIONS.md#d0091)): a native transfer, or a token
   `transfer(to, amount)`, only when the recipient is the rescue address or a saved address. One
   exception: a 0-value transfer to the wallet itself, which is how a stuck transaction is cancelled
   (spec 6, section 6). Saving an address changes the policy, so it needs the owner key
   (self-hosted) or the user's Privy sign-in (Cloud).
5. **Signing method** `eth_signTransaction` only. No `personal_sign`, no typed data except named
   Permit2 domains towards a registry spender, and no EIP-7702 authorization: no rule names
   `eth_sign7702Authorization`, so Privy denies every one (Privy refuses a rule for that method
   without conditions, so the ceiling holds no `DENY` rule for it; the exact match of section 6
   refuses a ceiling that gained an allow rule).

Everything else is refused by Privy.

**A launch wallet's ceiling** ([decision 0217](../DECISIONS.md#d0217)). An agent may hold one
launch wallet, made with the owner key by `binference wallet create --launch`. Its ceiling holds
every rule above, and on each chain, for every launchpad the install runs, one rule per call the
launchpad declares on the contracts each launch makes (`Launch call <function>, chain <id>`): the
function by `function_name` with its JSON ABI and no `to` condition, each input the launchpad pins
equal to `{{wallet.address}}`, at most the per-transaction cap and under the chain's 24-hour native
cap; and, when a launchpad names a launch contract as its spender, `Launch approvals, chain <id>`:
an `approve` with no native coin naming any spender, under each capped token's 24-hour cap. No
agent wallet's ceiling holds a launch rule, and no ceiling lists a launch wallet as a recipient:
saving a launch wallet's address, or making it the rescue address, is refused as
`address.launch_wallet`, and a saved address that names one never reaches a ceiling
([decision 0218](../DECISIONS.md#d0218)). The owner funds it from outside. A thief with this
machine's keys can take what the launch wallet holds, within the 24-hour caps for the coin, WBNB,
USDT and USDC, and nothing more from the agent's other wallets than the promise below allows. Curve
sales and sales through the pools pay the launch wallet, so its proceeds stay there until a rescue
takes them back; an allowance a stolen key grants from it outlives a rescue, so after a theft the
owner funds that launch wallet no more.

**What it promises** ([decision 0149](../DECISIONS.md#d0149)). A machine whose keys are stolen
cannot send BNB or a token to an address the owner did not save, cannot call a contract or a
function no enabled venue declares, and cannot approve a spender no enabled venue declares. Through
venue calls it can lose at most the 24-hour caps: the BNB the wallets send, and the approvals of
WBNB, USDT and USDC. It can trade at a bad price inside them, and sell any other token the wallet
holds at any price: a swap into a pool its caller owns pays the caller, whatever its receiver
field says, and Privy reads only a function's top-level inputs.

**The 24-hour caps** are Privy aggregations: rolling sums Privy records after it signs, at most 10
per app. Init makes them once, owned by the owner key's quorum, and every ceiling of the install
names the same ones, so they bound all its wallets together. Each is twice
`defaults.limits.rollingDayUsd`, counting BNB and WBNB at $100 and each stablecoin at $1: 10 BNB, 10
WBNB, 1,000 USDT and 1,000 USDC by default. The native sum counts every transaction on the chain,
sends to saved addresses among them; a send itself is never capped. They are disaster limits:
parallel requests can pass together and a request counts once signed, landed or not, so the engine's
rolling caps stay the main money limit. `binference ceiling` and `ceiling/get` show each cap: what
it counts, its size in the asset's units and in dollars at the floor price, and its window. The
owner key resizes them with `binference ceiling set --day-cap-usd <dollars>`: each cap becomes that
many dollars at its floor price in every ceiling of the install, through the rules that compare it;
the aggregations and their sums stay ([decision 0151](../DECISIONS.md#d0151)).

Nor can it pin a transaction's calldata: Privy's transaction conditions read only `to`, `value`
and `chain_id`, so the self-cancel rule allows any calldata to the wallet itself. The ceiling
relies on the wallets never carrying delegated code, which only an EIP-7702 authorization the
wallet signs could set; no rule allows one, and the signer refuses a type 4 transaction
or an authorization list (section 5.2, rule 4).

Nor can it deny one function on every contract. Privy denies every transaction that a `DENY` rule
on calldata cannot decode, plain sends among them, so the policy holds allow rules only. A venue
call carries only a function its venue declares, so no rule allows `setApprovalForAll` on a
contract, and the signer's hard rules (section 5.2) refuse it too.

**Under the ceiling,** the engine's limits (per-trade and daily caps, send levels, allow and deny
lists) can be loosened from the CLI, the console or the Mini App
([decision 0089](../DECISIONS.md#d0089)), never past the ceiling. Raising the ceiling, adding a
venue to it, or saving a send address is an owner-key action in the CLI:
`binference ceiling set` and `binference address add`, each asking for the owner key code. The owner
key never enters a browser or a chat.

Send levels ([ARCHITECTURE.md section 11](../ARCHITECTURE.md#section-11)) now apply within the saved
addresses: levels 0 and 1 send to any saved address with a tap; level 2 makes a newly saved address
usable 24 hours after saving; level 3 allows no sends.

<a id="section-5"></a>

## 5. The signer process

- The engine starts the signer as a child process and passes it, over stdin, one line of settings
  (the enabled chains and Privy's API origin) and then the agent key, read from the unlock mode.
  The signer never reads config, the databases or the network.
- The engine builds each Privy request (`POST /v1/wallets/<id>/rpc` with method
  `eth_signTransaction`). The signer checks it (section 5.2) and returns Privy's authorization
  signature over that exact request. The engine adds the app secret, sends it to Privy, receives the
  signed raw transaction, stores it, and broadcasts it through private relays
  ([rule 6](../ARCHITECTURE.md#rule-6)). Neither half can sign alone: the app secret cannot
  authorize, and the agent key cannot reach Privy.
- Key buffers are zeroed after use and on exit. The service units turn core dumps off (`LimitCORE=0`
  for systemd, the equivalent for launchd).
- It talks to the engine over its standard input and output, pipes only the engine holds, one
  JSON line per message and one request at a time per wallet. It opens no socket or named pipe:
  Node's permission model allows one only with `--allow-net`, which allows every TCP connection
  too, and the signer runs with no grant at all.

<a id="section-5-1"></a>

### 5.1 Requests

| Request     | Fields                                                                                                                                                                                                                                                | Answer          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `publicKey` | none                                                                                                                                                                                                                                                  | `{ publicKey }` |
| `authorize` | `wallet`, `request` (Privy method, URL, body and the `privy-` headers the signature covers), `intent`, `step`, `authorization` (a confirmation, an order, a webhook rule or the auto mode), `termsHash`, `allowed` (the registry's set for this step) | `{ signature }` |

Every request is a zod-checked JSON message with an `id`. Unknown requests are refused. The
`authorize` request is one type in `@binference/chain`, which the engine, custody and the signer
share. Privy's signature covers `{ version: 1, method, url, body, headers }` as RFC 8785 JSON,
where `headers` holds `privy-app-id` and, when the request has them, `privy-idempotency-key` and
`privy-request-expiry`, and no other header
([implementing signing directly](https://docs.privy.io/controls/authorization-keys/using-owners/sign/direct-implementation)).

<a id="section-5-2"></a>

### 5.2 Hard rules the signer checks itself

The signer reads the transaction out of the Privy request body and trusts nothing else the engine
says without checking it:

1. The chain is enabled and is the transaction's chain.
2. `to` is in `allowed`: the venue's declared contracts, a token for an exact approval to a registry
   spender, or the confirmed recipient of a send, bridge or rescue. From a launch wallet
   (`wallet.role` is `launch`), a call may also go to, and an approval name, a contract of the
   launch the step trades on (`allowed.launch`), which the engine reads from the launchpad as the
   wallet queue takes the intent and again before each later step and speed-up, and an approval
   may also name a registry contract of the route's venues; from any other wallet such a call or
   approval breaks this rule ([decision 0217](../DECISIONS.md#d0217)). The engine asks the signer
   only with the launch read in hand ([decision 0218](../DECISIONS.md#d0218)). The wallet's role
   and its launch contracts both come from the engine, so against a compromised engine process
   this rule adds no wall for a launch wallet, as for any wallet's `allowed`.
3. Value and amounts equal the plan's amounts for that step; an approval is never above the step's
   amount, and never unlimited.
4. The method is `eth_signTransaction`; no EIP-7702 authorization, no `personal_sign`, and typed
   data only for a named domain. The request carries `privy-request-expiry`, at most 5 minutes
   from now, so no signature lasts longer.
5. The fee per gas is at most the chain's network fee cap from the signer's settings, whatever
   authorized the transaction, and a chain with no cap there signs nothing ([decision
   0143](../DECISIONS.md#d0143)). `termsHash`, the hash of the request, quote and plan that run
   (spec 6, section 1), matches the authorization's: a confirmation that has not expired, an auto
   order's fill grant, an active webhook rule whose bounds hold, or the agent's current auto-mode
   grant for an intent that passes the auto test (spec 6, section 5). A fill grant holds for the
   intent it names while the order the engine read right before the signature holds the card
   terms the owner confirmed, is `active`, before its expiry, with a fill left and with the fills
   it had when the fill was proposed; the transaction pays at most the grant's fee cap per gas and
   spends at most the grant's most of what the fill spends, a call's native value for the coin or
   an approval's amount for a token, and sends no coin with a call while the fill spends a token;
   a send never fills an order; and the grant lasts 60 seconds from the fill's confirmation
   ([decision 0210](../DECISIONS.md#d0210)). A grant longer than 60 seconds, or granted after now,
   holds nothing. A step after the fill's first also signs while a freeze pauses its order, so a
   sale under way finishes. While the signer runs, it signs one fill intent per order and fills
   before: a step of another intent under the same count breaks rule 5. An approval of the fill's
   token for 0, which resets one its earlier step set, signs whatever the order became, until 60
   seconds after the grant expired ([decision 0211](../DECISIONS.md#d0211)). One exception: a cancel (rule 6) of the confirmed
   intent, or of an order's fill whatever the order became, signs for 60 seconds after its
   confirmation or grant expired ([decision 0116](../DECISIONS.md#d0116)).
6. For a speed-up or a cancel at an already used nonce: the calldata is identical (speed-up) or the
   transaction is a 0-value transfer to the wallet itself (cancel).

A refusal is logged with the rule number, never with key material, and raises
`notice.signerRefused`, which names the rule in plain words on every surface.

<a id="section-6"></a>

## 6. Recovery and machine changes

- **Lost or replaced machine:** `binference init --attach` on the new machine asks for the Privy app
  details and the owner key, makes a new agent key, adds it as each wallet's signer and removes the
  old one, all signed with the owner key. The wallets, their addresses and their funds never move. A
  backup (section 7) brings back orders, history and settings. Each wallet changes in one request
  the owner key signs, which sets the new key as its one signer, so no wallet takes two machines'
  signatures; attach runs on a folder that holds the install and prints this machine's signer ID
  ([decision 0140](../DECISIONS.md#d0140)). No wallet moves until Privy reads the new key quorum
  back holding this machine's agent key alone. Each change of attach and of `signer revoke`
  expires 5 minutes after it is signed; one Privy reads later stops the move there as expired,
  and the same command again goes on from where it stopped.
- **Planned move** ([decision 0142](../DECISIONS.md#d0142)): the owner runs
  `binference service remove` on the old machine, copies its state folder without `keys/` to the
  new machine, and runs `binference init --attach` there. Attach refuses a copy whose
  `engine.sqlite` was left open (its `engine.sqlite-wal` or `engine.sqlite-shm` is there), and a
  copied `keys/agent-key` that holds the key the wallets name now. A secret source of
  `config.json5` that names a file in the old folder's `keys/` moves to this folder's `keys/`, and
  attach asks for that secret, hidden. Once backups exist, `binference init --attach --restore
<file>` replaces the copy.
- **Lost machine with no backup** ([decision 0142](../DECISIONS.md#d0142)): `binference init
--attach` on an empty folder rebuilds what Privy holds. It warns first that history, orders,
  settings, wallet labels, saved addresses and the bot's pairing start fresh. It takes the Privy
  app and the owner key, finds the wallets the app holds whose owner is the owner key alone (Privy's
  `authorization_key` filter), each under one ceiling the same key owns whose rules are exactly
  the ones binference builds, its token sends paying the addresses its native sends pay. It
  lists each wallet with the time Privy made it and marks each launch wallet, and reads the
  rescue address when every ceiling lets sends pay exactly one address in common, never a launch
  wallet's; otherwise the owner names one of the shared addresses. It adopts launch wallets too
  ([decision 0218](../DECISIONS.md#d0218)): after the agent wallets, the newest first, which
  becomes the agent's launch wallet; any other is an extra launch wallet that nothing trades from,
  which `wallet list` and `binference check` name so the owner rescues it. An owner key that owns
  only launch wallets is refused. Nothing changes on Privy until the owner types the number of wallets found. Then, as
  `init` does, it takes the bot and the limits, makes one agent with the default settings and this
  machine's agent key, moves every wallet's signer to that key, records each wallet with its
  ceiling, and issues the bot's pairing link. A folder that holds a config file but no install is
  refused.
- **Machine compromised:** `binference signer revoke` from any other machine with the owner key, or
  the Privy dashboard, removes the agent key at once. Funds stay; the attacker could only have
  signed inside the ceiling until then. A revoke never removes the engine's own key or a wallet's
  last signer: attaching the machine that replaces it does that. `binference service remove` on
  the old machine keeps it from starting at login ([decision 0141](../DECISIONS.md#d0141)).
- **Owner key lost:** the wallets keep working inside the ceiling, but nothing can loosen it, export
  a key or attach a machine. The owner moves funds out to the rescue address (always allowed) and
  starts again with a new owner key. `init` says so when it shows the code.
- **Export:** `binference wallet export` (IPC only) asks for the owner key, requests Privy's export
  with a fresh HPKE key pair, decrypts it in the CLI process, prints it once and zeroes it.

<a id="section-7"></a>

## 7. Backups

Decided in [decision 0055](../DECISIONS.md#d0055), amended by
[decision 0164](../DECISIONS.md#d0164); restores by [decision 0162](../DECISIONS.md#d0162) and
[decision 0163](../DECISIONS.md#d0163).

<a id="section-7-1"></a>

### 7.1 What a backup holds

A tar archive of:

- snapshots of `engine.sqlite` and `agent.sqlite`, made with SQLite's `VACUUM INTO` (never a copy of
  a live file);
- `config.json5` (secret sources are references, so no secrets travel);
- `workspace/` (every agent's files and skills);
- `manifest.json`: the binference version, schema versions, the Privy app id and wallet ids, the
  file list with SHA-256 of each.

The agent key and the app secret are never in a backup.

<a id="section-7-2"></a>

### 7.2 The file

`~/.binference/backups/binference-<install id>-<yyyymmdd-hhmm>-<kind>.bnfbak`

1. **Header**: one line of JSON, then a newline:
   `{ format: "binference-backup", version: 3, installId, createdAt, kind, binferenceVersion, cipher: "aes-256-gcm-stream", chunkBytes: 65536, noncePrefix, wrappedKey }`.
2. **Data key**: 32 random bytes per backup. `wrappedKey` is the data key sealed with HPKE (RFC
   9180: DHKEM P-256, HKDF-SHA256, AES-256-GCM, `info` `binference-backup v3`) to the public half
   of the **sealing key** ([decision 0164](../DECISIONS.md#d0164)). The machine can make backups
   without the owner key; only the owner key can open them.
3. **Body**: the tar archive in 64 KiB chunks. Chunk `i` is AES-256-GCM under the data key, with
   nonce `noncePrefix (8 random bytes) || i (4 bytes, big-endian)` and associated data
   `SHA-256(header) || i || final flag (1 byte)`, so chunks cannot be reordered, dropped or cut off
   at the end.
4. A wrong owner key fails at the HPKE step, before any chunk is read.

**The sealing key.** The owner key signs Privy requests with ECDSA and does nothing else; backups
are sealed to a P-256 key pair derived from it. HKDF-SHA256 (RFC 5869) over the owner key's 32-byte
private scalar, with no salt and the `info` `binference sealing key v1`, gives 32 bytes of keying
material; RFC 9180's DeriveKeyPair for DHKEM(P-256, HKDF-SHA256) maps them to a valid scalar. The
same owner key always derives the same sealing key, and the owner key code stays the one secret
the owner keeps. The install keeps the sealing key's public half in `custody.seal_key_public`:
`binference init` when it makes the owner key at the terminal, `init --attach`, a rebuild and a
restore from the owner key they are given. An install made before, or one whose owner key init
took by its public half alone, keeps none until the owner key is entered once in any request that
proves it (a ceiling change, an export, a signer revoke, an attach, a restore); binference then
derives the key and keeps its public half, and `binference status` shows the `backup_key` signal
as needing a look until it has.

**Version 2.** A backup made before the install kept the sealing key says `version: 2`; its data
key is sealed to the owner key's own public half with the `info` `binference-backup v2`. It still
opens with the owner key; a version 3 file opens with the sealing key alone.

**Who wrote it.** Sealing says who may open a file, not who wrote it: anyone who knows the public
half can seal a file to it. The install therefore records the SHA-256 of each backup file it writes
and of its header line in `engine.sqlite` (`backups.file_sha256`, `backups.header_sha256`;
[decision 0163](../DECISIONS.md#d0163)), and a restore checks a file against them (section 7.4).

<a id="section-7-3"></a>

### 7.3 Schedule and checks

- Daily at 03:30 owner time, and before every update and migration. Kept: 7 daily, 4 weekly (the
  Sunday ones), the last 3 before updates and migrations. A Sunday backup counts among the daily
  ones too. Backups the owner takes by hand stay until the owner removes them.
- A missed night is caught up: when the engine starts, or the machine wakes from sleep, and the
  newest daily or weekly backup is more than 24 hours old, one is taken at once, weekly on a
  Sunday. With none yet, the 24 hours count from when this machine's agent key became the
  wallets' signer. The engine sees a wake as a jump of its wall clock between two of the backup
  timer's one-minute ticks, since a sleeping machine stops the timer, never the wall clock.
- A failed backup before a migration stops the start: the migration never runs without it.
- Each new backup is verified right after it is written, while the engine still holds its data key:
  the file is read back, every chunk's tag and every file's SHA-256 checked, then the data key is
  zeroed. Verification never needs the owner key. Only then is the backup copied to `backups.copyTo`
  and marked `verified_at`.
- A failed backup or check raises a notice.

<a id="section-7-4"></a>

### 7.4 Restore

A backup is restored by `binference backup restore <file>` on this machine's install, or by
`binference init --attach --restore <file>` on a new machine. Both run in the CLI, never in the
engine ([decision 0152](../DECISIONS.md#d0152)): the owner key comes only from the terminal's hidden
prompt and never travels to the engine, and protocol v1 serves no `backup/restore`.

1. Ask for the owner key; open `wrappedKey` (with the sealing key it derives for a version 3
   file, with the owner key itself for a version 2 one).
2. Decrypt to a temporary folder in the state folder and verify every tag and hash.
3. Refuse a backup whose schema versions are newer than this binference.
4. Prove the backup genuine ([decision 0163](../DECISIONS.md#d0163)), before anything opens the
   databases it holds: a file whose header digest and file digest match a record of the state it
   would replace goes on. Any other file, and every file on a machine whose state holds no records,
   is shown with its install id, its time and its wallets, with a warning, and goes on only once
   the owner types the day it was taken, `yyyy-mm-dd`.
5. Check that the wallets in the manifest are the ones Privy reports for this owner; a mismatch
   stops the restore.
6. Show what the restore changes and ask to go on ([decision 0162](../DECISIONS.md#d0162)): what
   it keeps as it is now, where the history ends, the agents and wallets that come or go, and the
   backup's stricter guards that stay. The owner types the backup's day to go on.
7. Stop the engine; under the engine lock, carry the guards of the state it replaces into the
   restored `engine.sqlite` (below) and keep the sealing key's public half there when its custody
   has none; move the current state aside (kept 7 days) and put the restored files in place, all or
   nothing; start the engine. Startup runs migrations and reconciliation as usual
   ([ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24)).

**A restore never loosens the install** ([decision 0162](../DECISIONS.md#d0162)). Read from the
`engine.sqlite` it replaces, once the engine stopped, and written into the restored one in one
transaction:

| What                                                                                                       | After the restore                                                                       |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| client tokens, console devices, push subscriptions, pairing and start codes, Mini App launches and tickets | as they are now: a revoke stays revoked, nothing the backup alone holds comes back      |
| the Telegram owner, the rescue address, its pending change and the rescue rules                            | the newer ones                                                                          |
| a freeze of the install or of an agent; an archived agent                                                  | stays                                                                                   |
| an agent's paper mode, manual approval mode, send level, each limit                                        | the stricter of the two in effect now; a looser one asked since still comes at its time |
| an address book entry removed since                                                                        | stays removed                                                                           |
| the outflows the rolling 24-hour cap counts now                                                            | `carried_outflows`, counted in the place of the restored copy's own                     |
| the backup records                                                                                         | both                                                                                    |

A replaced `engine.sqlite` that does not open is said so before the owner confirms, and nothing of
it can be carried; one of an older schema is refused until binference started once on it.

**All or nothing.** The restored files are staged in a folder of the state folder, so each move is
a rename on one disk. When a rename fails, every rename made is reversed, newest first, and nothing
changed; a reversal never moves onto a path a failed move still holds, and one that fails too
leaves both states where the refusal names them, with nothing started. When the engine does not
reach `ready` or `locked` after the start, the restore stops it, puts the replaced state back,
starts the engine again on it and exits 1. The staged folder goes once the swap is done or undone.

`binference backup restore <file>` checks before it stops the engine, so a refusal changes nothing:
the Privy app must be the one `config.json5` names, the wallets must match (step 5), and Privy must
list the backup's agent key quorum as each wallet's signer now, so no signer moves. A backup that
names another signer is refused with a pointer to `binference init --attach --restore`. It then
stops the engine as `binference stop` does (`engine/stop`, then the service manager for the
background service), carries the guards and swaps the files under the engine lock, and starts the
engine as it ran: the background service again, or, for an engine that ran in a terminal, in the
foreground in the restore's terminal. An engine that was not running stays stopped. A refusal after
the stop starts the engine again as it ran. `init --attach --restore` makes this machine's new
agent key the wallets' signer after the swap; when it stops before a wallet moves, the restore is
undone.
