# Spec 5: custody, keys, signing and backups

Status: accepted on 2026-10-06 ([decision 0097](../DECISIONS.md#d0097)). It follows Privy custody
(decisions [0085](../DECISIONS.md#d0085), [0087](../DECISIONS.md#d0087) and
[0091](../DECISIONS.md#d0091)).

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
3. **Agent key.** Init makes a second P-256 key pair for this machine and stores the private half
   through the unlock mode (section 3).
4. **On Privy, signed with the owner key while init holds it:** a key quorum for the owner key, a
   key quorum for the agent key, the policy (section 4), and the first agent wallet, owned by the
   owner quorum, with the agent quorum as its signer bound to the policy.
5. Init reads the wallet back from Privy and refuses to finish unless the owner, the signer and the
   policy are exactly what it asked for.

More wallets (`binference wallet create`) and policy changes need the owner key again: the CLI asks
for the code, uses it for that one request, and forgets it.

**Cloud** does the same through binference.io: the user signs in, Privy's own window asks their
consent, the wallet is made in their Privy account with our signer service under the policy
([ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)).

<a id="section-3"></a>

## 3. The agent key and the app secret at rest

Decided in [decision 0065](../DECISIONS.md#d0065).

| `engine.unlock.mode` | Where the agent key and the app secret live                                                                                                                                      | Default when              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `keychain`           | The OS keychain: service `binference`, accounts `agent-key` and `privy-app-secret`                                                                                               | A desktop session exists  |
| `file`               | `~/.binference/keys/`, readable only by the service user (`0400`; an owner-only ACL on Windows), or the systemd credentials `binference-agent-key` and `binference-privy-secret` | Headless Linux and Docker |
| `command`            | Secret sources `{ fromCommand: [...] }` (1Password, Vault, pass)                                                                                                                 | Never by default          |
| `manual`             | The agent key in an encrypted file (below), opened by `binference unlock` over IPC after each start                                                                              | Never by default          |

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

While locked, the engine answers reads, refuses signing with `engine.locked`, and auto orders, auto
mode and webhook rules wait. A notice tells the owner on every surface. `binference check` warns in
`file` mode: a copy of the disk plus that folder lets someone sign inside the ceiling until the
owner removes the agent key.

<a id="section-4"></a>

## 4. The ceiling: each wallet's Privy policy

The policy is the second wall ([rule 18](../ARCHITECTURE.md#rule-18)). It allows only:

1. **Chain 56** (BSC), and later each chain the owner enables.
2. **Contract calls** whose `to` is in the registry's set for the agent's enabled venues (routers,
   launchpads, lending markets, staking, bridges), with a native value at most the per-transaction
   cap (`defaults.ceiling.perTxBnb`, 1 BNB by default, [decision 0094](../DECISIONS.md#d0094)).
3. **Approvals:** `approve(spender, amount)` on any token, only when `spender` is in the registry's
   spender set; never `setApprovalForAll`.
4. **Sends** ([decision 0091](../DECISIONS.md#d0091)): a native transfer, or a token
   `transfer(to, amount)`, only when the recipient is the rescue address or a saved address. One
   exception: a 0-value transfer to the wallet itself, which is how a stuck transaction is cancelled
   (spec 6, section 6). Saving an address changes the policy, so it needs the owner key
   (self-hosted) or the user's Privy sign-in (Cloud).
5. **Signing method** `eth_signTransaction` only. No `personal_sign`, no typed data except named
   Permit2 domains towards a registry spender, no EIP-7702 authorization except Privy's own.

Everything else is refused by Privy. What the policy cannot do: count dollars. Privy's spending
counters sum token units, count after signing and are at most 10 per app, so the engine's rolling
caps stay the main money limit and the counters are only a backstop on BNB.

Nor can it deny one function on every contract. Privy denies every transaction that a `DENY` rule
on calldata cannot decode, plain sends among them, so the policy holds allow rules only. A call to
a listed contract may then carry any function, and the signer's hard rules (section 5.2) refuse
`setApprovalForAll` there; outside the listed contracts, no rule allows it.

**Under the ceiling,** the engine's limits (per-trade and daily caps, send levels, allow and deny
lists) can be loosened from the CLI, the console or the Mini App
([decision 0089](../DECISIONS.md#d0089)), never past the ceiling. Raising the ceiling, adding a
venue's contracts to it, or saving a send address is an owner-key action in the CLI:
`binference ceiling set` and `binference address add`, each asking for the owner key code. The owner
key never enters a browser or a chat.

Send levels ([ARCHITECTURE.md section 11](../ARCHITECTURE.md#section-11)) now apply within the saved
addresses: levels 0 and 1 send to any saved address with a tap; level 2 makes a newly saved address
usable 24 hours after saving; level 3 allows no sends.

<a id="section-5"></a>

## 5. The signer process

- The engine starts the signer as a child process and passes it the agent key over stdin, read from
  the unlock mode. The signer never reads config, the databases or the network.
- The engine builds each Privy request (`POST /v1/wallets/<id>/rpc` with method
  `eth_signTransaction`). The signer checks it (section 5.2) and returns Privy's authorization
  signature over that exact request. The engine adds the app secret, sends it to Privy, receives the
  signed raw transaction, stores it, and broadcasts it through private relays
  ([rule 6](../ARCHITECTURE.md#rule-6)). Neither half can sign alone: the app secret cannot
  authorize, and the agent key cannot reach Privy.
- Key buffers are zeroed after use and on exit. The service units turn core dumps off (`LimitCORE=0`
  for systemd, the equivalent for launchd).
- It talks to the engine over a private IPC endpoint (`~/.binference/run/signer.sock`, or the named
  pipe `\\.\pipe\binference-<install id>-signer` on Windows), owner-only, one request at a time
  per wallet.

<a id="section-5-1"></a>

### 5.1 Requests

| Request     | Fields                                                                                                                                                                                                     | Answer          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `publicKey` | none                                                                                                                                                                                                       | `{ publicKey }` |
| `authorize` | `wallet`, `request` (Privy method, URL and body), `intent`, `step`, `authorization` (a confirmation, an order, a webhook rule or the auto mode), `termsHash`, `allowed` (the registry's set for this step) | `{ signature }` |

Every request is a zod-checked JSON message with an `id`. Unknown requests are refused.

<a id="section-5-2"></a>

### 5.2 Hard rules the signer checks itself

The signer reads the transaction out of the Privy request body and trusts nothing else the engine
says without checking it:

1. The chain is enabled and is the transaction's chain.
2. `to` is in `allowed`: the venue's declared contracts, a token for an exact approval to a registry
   spender, or the confirmed recipient of a send, bridge or rescue.
3. Value and amounts equal the plan's amounts for that step; an approval is never above the step's
   amount, and never unlimited.
4. The method is `eth_signTransaction`; no EIP-7702 authorization, no `personal_sign`, and typed
   data only for a named domain.
5. `termsHash` matches the authorization's: a confirmation that has not expired, an active order or
   webhook rule whose bounds hold, or the agent's current auto-mode grant for an intent that passes
   the auto test (spec 6, section 5).
6. For a speed-up or a cancel at an already used nonce: the calldata is identical (speed-up) or the
   transaction is a 0-value transfer to the wallet itself (cancel).

A refusal is logged with the rule number, never with key material, and raises a notice.

<a id="section-6"></a>

## 6. Recovery and machine changes

- **Lost or replaced machine:** `binference init --attach` on the new machine asks for the Privy app
  details and the owner key, makes a new agent key, adds it as each wallet's signer and removes the
  old one, all signed with the owner key. The wallets, their addresses and their funds never move. A
  backup (section 7) brings back orders, history and settings.
- **Machine compromised:** `binference signer revoke` from any other machine with the owner key, or
  the Privy dashboard, removes the agent key at once. Funds stay; the attacker could only have
  signed inside the ceiling until then.
- **Owner key lost:** the wallets keep working inside the ceiling, but nothing can loosen it, export
  a key or attach a machine. The owner moves funds out to the rescue address (always allowed) and
  starts again with a new owner key. `init` says so when it shows the code.
- **Export:** `binference wallet export` (IPC only) asks for the owner key, requests Privy's export
  with a fresh HPKE key pair, decrypts it in the CLI process, prints it once and zeroes it.

<a id="section-7"></a>

## 7. Backups

Decided in [decision 0055](../DECISIONS.md#d0055).

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
   `{ format: "binference-backup", version: 2, installId, createdAt, kind, binferenceVersion, cipher: "aes-256-gcm-stream", chunkBytes: 65536, noncePrefix, wrappedKey }`.
2. **Data key**: 32 random bytes per backup. `wrappedKey` is the data key sealed to the owner key's
   public half with HPKE (RFC 9180: DHKEM P-256, HKDF-SHA256, AES-256-GCM). The machine can make
   backups without the owner key; only the owner key can open them.
3. **Body**: the tar archive in 64 KiB chunks. Chunk `i` is AES-256-GCM under the data key, with
   nonce `noncePrefix (8 random bytes) || i (4 bytes, big-endian)` and associated data
   `SHA-256(header) || i || final flag (1 byte)`, so chunks cannot be reordered, dropped or cut off
   at the end.
4. A wrong owner key fails at the HPKE step, before any chunk is read.

<a id="section-7-3"></a>

### 7.3 Schedule and checks

- Daily at 03:30 owner time, and before every update and migration. Kept: 7 daily, 4 weekly (the
  Sunday ones), the last 3 before updates and migrations.
- Each new backup is verified right after it is written, while the engine still holds its data key:
  the file is read back, every chunk's tag and every file's SHA-256 checked, then the data key is
  zeroed. Verification never needs the owner key. Only then is the backup copied to `backups.copyTo`
  and marked `verified_at`.
- A failed backup or check raises a notice.

<a id="section-7-4"></a>

### 7.4 Restore

`binference backup restore <file>` (IPC only) or `binference init --attach --restore <file>`:

1. Ask for the owner key; open `wrappedKey`.
2. Decrypt to a temporary folder and verify every tag and hash.
3. Refuse a backup whose schema versions are newer than this binference.
4. Stop the engine, move the current state folder aside (kept 7 days), put the restored files in
   place, start the engine; startup runs migrations and reconciliation as usual
   ([ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24)).
5. Check that the wallets in the manifest are the ones Privy reports for this owner; a mismatch
   stops the restore.
