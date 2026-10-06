# binference: architecture

binference is an open-source AI agent for BNB Smart Chain. It runs on the owner's machine or a
server, talks to the owner on Telegram, in a web console and in the terminal, and does on chain what
a human trader does: swaps, launchpad trades, auto orders, lending, staking, bridges, and trades on
Binance through Binance Agent OS. Any MCP client, such as Claude Code or Codex, can use the same
engine through its MCP server.

This page holds the rules every part of binference follows, then the architecture. The decisions
behind them are in [DECISIONS.md](DECISIONS.md), the engineering rules in
[ENGINEERING.md](ENGINEERING.md) and the specs in [specs/](specs/).

<a id="rules"></a>

## Rules

Every part of binference follows these rules. A rule changes only through a new decision in
[DECISIONS.md](DECISIONS.md).

1. <a id="rule-1"></a>**The model proposes, code disposes.** The model only emits typed intents,
   such as "swap 0.5 BNB to USDT, at most 0.5% slippage".
   - It never writes calldata.
   - It never picks the signing wallet from free text.
   - It never sees a key.
   - It is never the last check.
2. <a id="rule-2"></a>**The engine is the trust boundary.** Confirmations, limits and the ledger
   live in the engine process; the agent's signing key lives only in the signer process, and the
   wallet keys only in Privy ([decision 0085](DECISIONS.md#d0085)). The agent runtime, plugins,
   skills and MCP clients such as Claude Code can only read and propose. None of them can approve;
   only the owner's surfaces and the owner's auto mode can ([decision 0088](DECISIONS.md#d0088)).
3. <a id="rule-3"></a>**Every card is drawn from the intent, never from model text.** Amounts,
   tokens, route, recipient, simulation result and risk flags all come from the stored intent. Token
   names and symbols are controlled by whoever deployed the token, so they are escaped: invisible
   and look-alike Unicode is shown as escapes.
4. <a id="rule-4"></a>**A confirmation binds the economic terms.** The tap approves the wallet, the
   action, the exact input, the minimum output, the recipient, the venues and the deadline. The
   recipient is always the agent's own wallet for swaps and DeFi. If the quote is older than the
   venue's re-quote age, the engine re-quotes and re-simulates. If the minimum output has worsened
   beyond the owner's tolerance, it asks again.
5. <a id="rule-5"></a>**No answer is a no.** A card expires with its quote: 60 seconds for trades,
   10 minutes for sends and DeFi ([decision 0093](DECISIONS.md#d0093)). Expired means cancelled.
6. <a id="rule-6"></a>**One wallet, one writer.** A per-wallet queue owns the nonce. The signed raw
   transaction is stored before it is broadcast. Recovery checks the chain by hash and nonce, and
   never signs again blindly.
7. <a id="rule-7"></a>**No LLM between a trigger and its fill.** Code evaluates limit, TP/SL,
   trailing, DCA and copy-trade fills. The model writes the order; code runs it.
8. <a id="rule-8"></a>**Approvals are exact.** No unlimited `approve`. Permit2 is used only with an
   amount and an expiry, and only towards allowlisted spenders.
9. <a id="rule-9"></a>**No blind signatures.** No `personal_sign`, no arbitrary EIP-712 and no
   EIP-7702 authorization. The only exceptions are named typed-data domains a venue needs: Permit2
   towards an allowlisted spender now, and Aster and Predict.fun orders later.
10. <a id="rule-10"></a>**Contract addresses come only from the registry.** Routers, pools, lending
    markets and bridges are read from `@binference/chain`'s registry, and each was checked on chain
    before it was added. A token address the owner pastes is allowed, and goes through the risk
    check.
11. <a id="rule-11"></a>**Braking is instant; loosening is not.**
    - `/freeze`, cancel and tighter limits work at once from any surface.
    - Loosening a send level takes 24 hours and is announced on every surface.
    - Unfreezing and other loosening need the CLI, the console or the Mini App, never a chat message
      or a card tap ([decision 0089](DECISIONS.md#d0089)).
12. <a id="rule-12"></a>**Third-party code never runs where keys are.**
    - Community plugins read data in a sandbox.
    - Only reviewed venue adapters, running inside the engine, may build transactions.
    - Their output is checked against what they declared and against simulation.
13. <a id="rule-13"></a>**Turns that read outside content are marked.** A turn that read the web, X,
    a Telegram group or token metadata carries an outside-content mark, and every card it produces
    carries a warning line saying so. This matters most for auto orders, whose single tap authorizes
    later fills.
14. <a id="rule-14"></a>**Every word a person sees ships in English and Chinese**
    ([decision 0018](DECISIONS.md#d0018)). Chinese follows the
    [Chinese terms](GLOSSARY.md#chinese-terms) in the glossary.
15. <a id="rule-15"></a>**Shell, file and browser tools are off by default.** The owner may turn
    them on for their own agent. Even then they run in the agent runtime, away from keys and
    confirmations.
16. <a id="rule-16"></a>**Beyond custody, the bot and a model, it needs no keys.** Self-hosted
    owners bring their Privy app, BotFather bot and model key ([decision 0087](DECISIONS.md#d0087));
    every other v1 default (routing, risk data, launch feed, RPC, private sends) is keyless. Keys
    only add speed, limits or extra venues.
17. <a id="rule-17"></a>**The code follows [ENGINEERING.md](ENGINEERING.md)**, and CI enforces it.
18. <a id="rule-18"></a>**Two walls on every transaction.** The engine and the signer check the hard
    rules first; the wallet's Privy policy is the ceiling behind them, and nothing on the machine
    can change it. Only the wallet's owner raises the ceiling ([section 8](#section-8)).
19. <a id="rule-19"></a>**The profile is wiring, never a branch.** Self-hosted and Cloud differ only
    in which adapters the composition root builds ([section 30](#section-30)). Core code never reads
    the profile.

<a id="architecture"></a>

## Architecture

Each section below is numbered; other pages cite it as "ARCHITECTURE.md section N".

<a id="section-1"></a>

### 1. The engine is the trust boundary

```text
                         ┌──────────── binference engine (Node 26, long-running) ────────────┐
 Telegram (owner's bot) ◄┤ surfaces: Telegram ingress (stored before ack), cards, commands   │
                         │ protocol: typed WS, scoped tokens                                   │
                         │ money: intents · policy · risk · simulation · confirmations         │
                         │        wallet queues (nonce) · private sends · reconcile · ledger   │
                         │ orders: auto orders · watchers · alerts           paper mode        │
                         │ store: engine.sqlite                                                │
                         │   └─ signer child process (agent key, hard rules)                   │
                         └───▲───────────▲──────────────▲──────────────▲──────────────────────┘
                 read, propose, chat     │ confirm      │ confirm       │ read, propose
                 ┌───────────┴──┐  ┌─────┴──────┐  ┌────┴─────┐  ┌──────┴────────────────┐
                 │ agent runtime│  │ OSS console │  │   CLI    │  │ MCP server            │
                 │ (LLM loop,   │  │ (browser,   │  │          │  │ (Claude Code, Codex,  │
                 │ skills, notes)│ │  Mini App)  │  │          │  │  any MCP client)      │
                 └──────────────┘  └─────────────┘  └──────────┘  └───────────────────────┘
```

- **The engine** is deterministic and has no LLM. It owns the Telegram bot, the protocol, the money
  path, auto orders and the store, and it supervises the signer.
- **The agent runtime** is a separate process, the brain:
  - the model loop, sessions, context, skills and memory;
  - the optional shell, file and browser tools.

  It receives chat from the engine, and it can only read and propose.

- **Scopes:**
  - `read`: portfolio, quotes, risk, orders, ledger.
  - `propose`: create intents and orders, which become cards.
  - `chat`: the agent runtime's channel to the owner.
  - `confirm`: given only to the owner's console devices and the CLI. Telegram taps are confirmed
    inside the engine itself.
  - `admin`: settings, given only to the CLI and paired consoles.

  MCP clients get `read` and `propose`, never `confirm`.

- **One command still runs everything.** `binference start` launches the engine, which supervises
  the agent runtime and the signer as child processes. Docker and the systemd or launchd units do
  the same.
- **When the owner chats through another agent product over MCP** and that product runs its own
  Telegram bot, the engine needs a second, confirmations-only bot from BotFather (one bot token can
  be polled by only one process), or the owner confirms in the console.

<a id="section-2"></a>

### 2. The public repo

```text
binference/                         MIT, pnpm + Turborepo, Node 26.1+, TypeScript 7, zod, Vitest
  packages/
    core/         @binference/core       Result, BinferenceError, branded ids, amount math, retry;
                                         Clock, Random, Logger and Http ports
    chain/        @binference/chain      chain-neutral model: CAIP ids, Amount, the ChainFamily,
                                         SigningScheme and ChainRegistry ports (no viem)
    chain-evm/    @binference/chain-evm  EVM family: viem, RPC failover, nonces, fees, eth_simulateV1,
                                         private relays, decoding, the EVM signing scheme
    chains/       @binference/chains     data only: one file per chain (bsc.ts), verified addresses
    platform/     @binference/platform   OS layer: paths, keychain, services, IPC, permissions (section 22)
    protocol/     @binference/protocol   zod schemas for frames, methods (scope, since), events; version
    client/       @binference/client     typed WS client (reconnect, pending map, seq gaps); browser + node
    engine/       @binference/engine     intents, policy, risk, quotes, venue host, confirmations,
                                         wallet queues, executor, reconciliation, ledger, paper mode,
                                         auto orders, watchers; no I/O of its own
    server/       @binference/server     the protocol server: node:http + ws, auth, scopes, console files
    signer/       @binference/signer     the signer process, the agent key, the hard rules
    custody-privy/ @binference/custody-privy  Privy custody for self-hosting: key quorums, the ceiling,
                                         wallets, signing calls (decision 0085)
    store/        @binference/store      SQLite adapters for the store ports, migrations, the Kysely
                                         dialect; one contract test suite per port
    telegram/     @binference/telegram   grammY: ingress, throttler, cards, fast commands, owner pairing
    runtime/      @binference/runtime    the agent runtime: loop, queues, sessions, context, compaction,
                                         skills loader, tool registry and policy, hooks, memory, providers
    console/      @binference/console    the OSS web console (React, Vite, shadcn), served by the engine;
                                         also the Telegram Mini App (section 25)
    tui/          @binference/tui        terminal chat (section 25)
    mcp/          @binference/mcp        MCP server (read and propose tools) and MCP client host
    plugin-sdk/   @binference/plugin-sdk manifest types, defineVenue / defineData / defineTool
    i18n/         @binference/i18n       en + zh messages, glossary, formatters, checks
    cli/          binference             the `binference` command and the composition root
  plugins/        first-party venues and data: pancakeswap, kyberswap, okx, flap, fourmeme, venus,
                  lista, aave, stakehub, across, relay, lifi, binance-agent-os, goplus, honeypot,
                  dexscreener, geckoterminal, codex, spaceid, erc8004, geniusfun, brew,
                  binance-agents
  skills/         bundled SKILL.md playbooks (section 5)
  .agents/skills/ skills for coding agents: clean-diff, review-diff, add-chain, add-venue, ... (decision 0037)
  apps/docs/      user docs: Markdown in English and Chinese, rendered by Starlight
  docs/           ARCHITECTURE.md, ENGINEERING.md, DECISIONS.md, GLOSSARY.md, specs/, adr/
  AGENTS.md       rules every coding agent loads; each package has its own AGENTS.md
  CONTRIBUTING.md how to contribute; SECURITY.md, how to report a security problem
  NOTICES.md      third-party notices for copied code (decision 0075)
```

The chain split makes the engine chain-agnostic ([decision 0022](DECISIONS.md#d0022)), `platform`
makes it OS-agnostic ([decision 0024](DECISIONS.md#d0024)), and `server` takes the transport out of
`engine`, so `engine` holds no I/O.

[ENGINEERING.md](ENGINEERING.md) holds the repo's rules: which package may import which, the
TypeScript and clean-code rules, comments, errors, logging, schemas, storage, config, security,
languages, tests, the style guard, dependencies, review and the setup for coding agents. The root
`AGENTS.md` and one `AGENTS.md` per package carry them, and `pnpm check` enforces them on Linux,
macOS and Windows.

<a id="section-3"></a>

### 3. The engine process

- **Ingress.** Every inbound event (Telegram update, console action, MCP or plugin call) is written
  to the store before it is acknowledged, keyed on its source id (`bot_id + update_id`, or the
  call's idempotency key).
- **Queues:**
  - `wallet:<account>`, width 1, keyed on the CAIP-10 account (`wallet:eip155:56:0x…`): owns the
    nonce, signs and broadcasts.
  - `intent:<id>`: each intent moves through its states under one owner.
  - `watch` and `schedule`: deterministic watchers and schedules, each with its own budget.
- **Protocol.** JSON frames over one WebSocket (the full spec is `specs/protocol.md`):
  - `call {id, op, args}`
  - `reply {id, result}` or `fail {id, error}`
  - `push {topic, data, seq}`

  The first frame is `open`, carrying the client's credential; the engine answers `ready` with its
  scopes. Every writing operation takes an idempotency key. Pushes carry a `seq`, and a gap makes
  the client refetch. The engine binds to loopback only, unless auth is configured.

- **Operations** are listed in `specs/protocol.md` section 7, named `domain/action`.
- **State directory** `~/.binference/` on every OS ([decision 0039](DECISIONS.md#d0039);
  `BINFERENCE_HOME` moves it):
  - `config.json5`: JSON5 config with a strict zod schema
  - `engine.sqlite`: intents, confirmations, transactions, orders, ledger
  - `agent.sqlite`: sessions, transcripts, memory
  - `keys/`: the agent's Privy signing key, owner-only ([decision 0085](DECISIONS.md#d0085))
  - `workspace/<agent>/`: `RULES.md`, `PERSONA.md`, `OWNER.md`, `STRATEGY.md`, `NOTES.md`,
    `FIRST-CHAT.md` and `skills/`
  - `logs/`

<a id="section-4"></a>

### 4. The agent runtime

binference runs its own agent loop on thin transports over the official `openai` and
`@anthropic-ai/sdk` clients. Their retries are off, because the runner owns retries and the AI
gateway's 429 answers carry `Retry-After`. A committed turn ends after its tool batch; a message
queued meanwhile starts a fresh turn.

The loop needs control that general-purpose SDK loops hide:

- side-effect tracking;
- new messages merged only at tool boundaries;
- no fallback once a propose tool has run.

One turn:

1. Admit the inbound message to its chat queue (one per session, width 1), and load the session.
2. Assemble the context ([section 5](#section-5)), with a stable cacheable prefix and a volatile
   tail.
3. Stream the model, validating tool calls with zod before they run.
4. Run read tools, in parallel where that is safe. Their results are size-capped, and
   network-sourced results put an outside-content mark on the turn.
5. A propose tool sends an intent to the engine and returns its id with "waiting for the owner's
   confirmation". The turn ends there and does not wait for the tap. When the intent settles
   (filled, denied, expired or failed), the engine sends the runtime a hidden result message, so the
   agent can report back and continue.
6. Once a propose tool has run, the turn becomes a committed turn. There is no automatic retry and
   no model fallback after that point; errors are reconciled and reported.

A message that arrives during a turn is merged in at the next tool boundary (`merge`, the default),
or waits for the turn to end (`after`). Cancelling a turn never cancels a confirmed transaction.

<a id="section-5"></a>

### 5. Context, memory and skills

- **Workspace files** per agent, editable in the console and the CLI:
  - `RULES.md`: operating rules (venues, risk appetite, what never to do).
  - `PERSONA.md`: persona and tone.
  - `OWNER.md`: the owner (language, timezone, how to address them).
  - `STRATEGY.md`: the owner's trading profile (sizes, holding times, sectors, exits).
  - `NOTES.md`: curated long-term notes.
  - `FIRST-CHAT.md`: the first-chat script ([decision 0061](DECISIONS.md#d0061)), removed once the
    first chat is done.

- **Live facts** sit below the cache boundary:
  - mode (paper or live) and whether the agent is frozen;
  - wallets and balances in USD;
  - open orders;
  - today's spend against limits;
  - the send level.
- **Memory.** Per-agent items with an origin label (`owner`, `agent`, `untrusted`, `system`), and
  full-text search (FTS5; vectors later). Memory is never a source of contract addresses
  ([rule 10](#rule-10)).
- **Skills.** `SKILL.md` files in the Agent Skills format: `name`, `description`, and optional
  `metadata`. binference reads its own fields under `metadata.binference`.
  - The prompt carries only an index (name, description, location); the model reads the full file
    when a task matches.
  - Skills are text: they cannot add tools or widen policy.
  - Bundled skills: `safe-swap`, `token-due-diligence`, `meme-hunting`, `dca-plan`, `copy-trading`,
    `lending-safety`, `staking`, `bridge-checklist`, `portfolio-review`, `failed-tx-postmortem`, and
    `binance-cex` (when the plugin is on).
  - The same skills, with a short `binference-tools` skill, teach Claude Code, Codex and other MCP
    clients how to use the engine.
- **Third-party skills** install from git or npm with a pinned hash. Binance Skills Hub, BNB Chain,
  PancakeSwap and Flap all publish skills in the `SKILL.md` format. A lint refuses, at install, any
  skill that tells the agent to ask for API keys or seed phrases.

<a id="section-6"></a>

### 6. Tools

**Read tools** (no confirmation):

| Tool                                  | What it does                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `portfolio`                           | Balances, USD values, positions and P&L across the agent's wallets                         |
| `token_info`                          | Metadata, price, liquidity, holders, and where it trades (curve or pool)                   |
| `token_risk`                          | GoPlus, honeypot.is, our round-trip simulation, launchpad mode and tax decode              |
| `quote`                               | Best route for a swap: venues, impact, minimum out                                         |
| `market_scan`                         | Trending tokens, new launches (Flap and four.meme events on chain), Binance Alpha listings |
| `chart`                               | OHLCV for a token                                                                          |
| `wallet_activity`                     | A wallet's trades and P&L (the agent's own or a tracked one)                               |
| `lending_markets`, `lending_position` | Rates, collateral factors, the agent's health factor                                       |
| `staking_options`                     | Validators (APR, commission, jail status), the slisBNB rate                                |
| `bridge_quote`                        | Routes, fees and times to and from other chains                                            |
| `tx_status`, `orders`                 | A transaction's state; the agent's auto orders                                             |
| `cex_*` (plugin)                      | Binance balances, positions, tickers and open orders through Agent OS                      |
| `search_web`, `search_x`, `read_page` | Outside content; marks the turn                                                            |
| `notes_search`, `notes_write`         | Labelled memory                                                                            |
| `open_skill`                          | Reads one installed skill's `SKILL.md` and its files, when the model needs the playbook    |

**Propose tools** (each creates an intent in the engine and a card; none signs):

| Tool                                     | Covers                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `swap`                                   | Any token pair, exact input or a percent of a position                                                                           |
| `buy`, `sell`                            | Launchpad-aware: the Flap Portal and four.meme while on the curve, pools after migration                                         |
| `send`                                   | BNB or BEP-20 to an address or a `.bnb` name, subject to the send level                                                          |
| `approval_revoke`                        | Revoke old allowances                                                                                                            |
| `order_create`                           | An auto order: limit, TP/SL, trailing, DCA or a copy-trade rule ([decision 0004](DECISIONS.md#d0004))                            |
| `lend` (supply, withdraw, borrow, repay) | Venus Core, Lista Lending, Aave v3, with a minimum health factor                                                                 |
| `stake`, `unstake`, `claim`              | Native BNB staking (StakeHub), slisBNB                                                                                           |
| `bridge`                                 | Across, Relay, LI.FI, as a cross-chain send to an address-book entry or the rescue address ([decision 0067](DECISIONS.md#d0067)) |
| `cex_order` (plugin)                     | Binance spot and convert orders through Agent OS; futures and margin off by default                                              |
| `token_launch`                           | A token on Flap, four.meme, Genius.fun or Brew; every launch setting is on its card ([decision 0082](DECISIONS.md#d0082))        |

**Control tools:** `order_cancel` (braking, so no confirmation), `alert_create` (price and wallet
alerts, no transaction), `schedule_create`, `schedule_list` and `schedule_cancel` (model turns on a
schedule, counted against the model budget; [section 26](#section-26)) and `ask_owner` (a question
with buttons).

**Never tools:** limits, send levels, paper or live mode, the address book, the rescue address, the
model budget, webhook rules and plugins. Those are settings that only the owner changes, in the CLI
or the console. `/rescue` is an owner command, never a tool.

The MCP server exposes the same read and propose tools, prefixed `binference_`.

<a id="section-7"></a>

### 7. The money path

```text
client (agent runtime, MCP): swap(tokenIn, tokenOut, amount, maxSlippage, reason)
  │
  ├─1 resolve      wallet (the agent's own, by alias), tokens (registry or pasted address), base units
  ├─2 policy       mode, frozen, venue allowed, token lists, per-trade and rolling 24-hour USD caps
  │                (USD from section 23), gas reserve, max tax, max slippage, send level,
  │                outside-content mark
  │                                                                        → rejected_policy
  ├─3 quote/build  venue adapter: quote → unsigned txs (exact approve + action)
  │                decode and assert: `to` in the adapter's declared contracts, recipient = own wallet,
  │                amounts = intent, minOut ≥ policy, deadline ≤ 60 s
  ├─4 risk         unknown tokens: GoPlus + honeypot.is + our buy → transfer → sell simulation from
  │                fresh addresses; launchpad mode and tax decode         → risk_blocked
  ├─5 simulate     eth_simulateV1 (traceTransfers): net balance changes must match the intent;
  │                no other outflows, no extra approvals
  ├─6 card         store intent (hash, quote time, expiry) → Telegram + console, EN/ZH
  ├─7 confirm      first answer wins; re-quote and re-simulate if the quote is old; new card if
  │                minOut moved past tolerance                             → denied | expired
  ├─8 execute      wallet queue: nonce → signer (hard rules again) → store raw tx → send to 2 or 3
  │                private relays → watch each block → finalized
  │                (paper mode stops here and fills at the confirmed quote)
  └─9 reconcile    decode logs into fills, compare with the simulation, update positions and P&L,
                   append to the ledger, notify every surface, tell the proposing client
```

**Intent states.** Spec 6 ([intent-states.md](specs/intent-states.md)) holds every state and
transition. In short, the normal path is
`proposed → checked → simulated → awaiting_confirmation → confirmed → signed → submitted → included → finalized → reconciled`.
An intent can also end in one of these terminal states:

- `rejected_policy`, `risk_blocked`
- `expired`, `denied`, `cancelled`
- `failed_onchain`, `replaced`, `dropped`
- `unknown_after_send`, which is reconciled by hash and nonce and never re-signed.

**Stuck transactions.** A transaction not included after about 20 blocks is simulated again:

- If it is still valid, the same bytes are broadcast again.
- If not, it is replaced at the same nonce with at least 10% more gas, sent to the same relays.

**Routing.** By default ([rule 16](#rule-16)):

- KyberSwap is the primary route and PancakeSwap's Smart Router (v2, v3 and Infinity) the second
  quote and the fallback, both keyless. Measured on 184 real trades, KyberSwap was within 1 bp of
  the better quote on 95% of them, PancakeSwap's SDK on 68%; KyberSwap answers in about 0.4 s, the
  SDK in about 4 s and some 450 RPC calls.
- Quotes are compared net of transfer tax and gas, and the simulation step decides: KyberSwap's
  quotes are already net of tax, the SDK's are not, and the tax sources disagreed on 4 of 10 taxed
  tokens, so tax is what our own simulation measures.
- One Infinity hook allowlist covers every route, aggregators included: a route through a pool whose
  hook is not on the list is dropped and the next quote is used.
- A "no pools" answer from the SDK is retried once before it counts as no route; the public node
  throttles its bursts.
- OKX, 1inch and 0x join when the owner adds their keys.
- Launchpad tokens still on their curve trade directly on Flap's Portal or four.meme's TokenManager.

**Risk tiers:**

- Verified tokens (in the registry) pass.
- Unknown tokens need a clean simulation, a clean GoPlus answer and liquidity above a floor.
- A hard flag blocks: honeypot, cannot sell, a hidden owner able to change balances, or a tax over
  the owner's maximum.
- When the risk sources are down, unknown tokens fail closed.

<a id="section-8"></a>

### 8. Wallets and signing

Decided in decisions [0085](DECISIONS.md#d0085) and [0087](DECISIONS.md#d0087).

Every agent wallet is a Privy server wallet, in both profiles. No machine running binference holds a
wallet's private key; Privy keeps it in its enclave. The full rules are spec 5
(`specs/keys-and-backups.md`).

```ts
interface Signer {
  account(walletId: WalletId, chain: ChainRef): Promise<AccountRef>;
  signTransaction(req: {
    walletId: WalletId;
    intentId: IntentId;
    authorization: ConfirmationId | OrderId | ApprovalModeGrant;
    tx: UnsignedTx; // family-specific, built by the chain family; its chain must be enabled
  }): Promise<SignedTx>;
}
```

- **Who owns a wallet.**
  - Self-hosted: the **owner key** (P-256) owns each wallet and its policy. `binference init` makes
    it, shows it once as a code for the owner to keep offline (a password manager), and keeps only
    its public half. It is needed to raise the ceiling, export a wallet or attach a new machine.
  - Cloud: the owner's own Privy account owns the wallet and its policy, through their bInference
    sign-in.
- **Who signs.** An added signer under the wallet's policy:
  - Self-hosted: the **agent key** (P-256), held only by the signer process, unlocked from the OS
    keychain, an owner-only file or a secret command ([decision 0065](DECISIONS.md#d0065)), together
    with the Privy app secret.
  - Cloud: our signer service, whose authorization key sits in KMS ([section 30](#section-30)).
- **The policy is the ceiling ([rule 18](#rule-18)).** Chain 56 only; `to` in the registry's router
  and token set for the agent's enabled venues; a per-transaction value cap; exact approvals; no
  EIP-7702 except Privy's own; no `personal_sign`. Only the owner changes it. The engine's limits
  sit under the ceiling and move freely up to it ([decision 0089](DECISIONS.md#d0089)). Privy's
  spending counters are a backstop only: they sum token units, count after signing, and an app has
  at most 10.
- **The signer process** re-checks the hard rules itself (spec 5, 5.2) before it asks Privy to sign
  with `eth_signTransaction`. The engine stores the raw transaction and broadcasts it through
  private relays ([rule 6](#rule-6)), so private sends and crash recovery work as before.
- **Adapters:** `privy-owner` (self-hosted, the owner's app and the agent key) and `privy-service`
  (Cloud, our signer service). Local keys may return later as a third adapter.
- **Losing the machine loses nothing.** The wallets live in Privy. `binference init --attach` on a
  new machine takes the owner key, adds the new agent key and removes the old one.
- **Export.** Self-hosted: `binference wallet export` asks for the owner key and decrypts Privy's
  export in the CLI only. Cloud: in Privy's own window on binference.io.
- **Honest limit.** A compromised machine can sign whatever the policy allows, up to the ceiling,
  until the owner removes the agent key. The ceiling is the real bound: keep it tight
  ([decision 0002](DECISIONS.md#d0002)).

<a id="section-9"></a>

### 9. Auto orders and watchers

- **An order** stores its bounds:
  - the wallet, token and side;
  - the size or budget;
  - the trigger (price, time or wallet event);
  - the worst acceptable price and the maximum slippage;
  - the expiry and the maximum number of fills.

  It is confirmed once with a card ([decision 0004](DECISIONS.md#d0004)). Each fill creates an
  intent marked `authorizedBy: orderId`, runs steps 1 to 5 and 8 to 9 of the money path without a
  card, and notifies afterwards. A fill that fails policy or risk is skipped and reported; it never
  widens itself.

- **Kinds in v1:**
  - limit buy and sell;
  - take-profit, stop-loss and trailing stop;
  - DCA (time-based);
  - a copy-trade rule: a leader wallet, size scaling and a per-leader cap, and token risk must pass;
  - price and wallet alerts, which send no transaction.
- **Watchers are code.**
  - Prices come from pool state read every block (or every N blocks) for the tokens with live
    orders. DEX Screener and GeckoTerminal serve as a cross-check.
  - Leader wallets and launches are watched through new-block logs.
- **After downtime ([decision 0066](DECISIONS.md#d0066)).** When the engine resumes after sleep, a
  reboot or a crash, each auto order checks the price now. It fills only if its trigger still holds
  and its worst price is respected; otherwise it is skipped and reported. Missed DCA buys are not
  replayed; the next one runs on time. Missed schedules run once, not once per missed interval. The
  owner gets one report: how long the engine was off, and what was checked, filled and skipped.
- **The model wakes only when it adds value.** Examples: "every morning, review my portfolio", or
  "when a new Flap token passes these filters, tell me and propose a buy". Those are cron or event
  triggers that start a turn in the agent runtime. There is no LLM heartbeat by default.

<a id="section-10"></a>

### 10. Paper mode

Decided in [decision 0019](DECISIONS.md#d0019).

New agents start in paper mode. Paper mode runs the whole money path up to the signer:

- real quotes, risk checks, simulation and cards;
- on confirm, a fill recorded at the confirmed quote;
- a paper portfolio with its own P&L;
- a "Paper" label on every card, receipt and console row.

A paper portfolio starts with 1 BNB and 500 USDT ([decision 0069](DECISIONS.md#d0069)), changeable
in onboarding and resettable at any time; it works with an empty real wallet.

Going live is one explicit step (`binference live` or the console), after the wallet is funded, and
the first live card says so.

<a id="section-11"></a>

### 11. Confirmations, send levels and the kill switch

**Approval modes ([decision 0088](DECISIONS.md#d0088)).** Each agent is in `manual` mode (the
default) or `auto` mode.

- **Manual:** every transaction outside a confirmed auto order needs one tap on Telegram or one
  click in the console. One tap is enough for any amount ([decision 0015](DECISIONS.md#d0015)).
- **Auto:** buys, sells and swaps, and moves inside the agent's own lending and staking positions,
  run without a tap when they fit the per-trade and daily caps. A receipt follows each one.
- **Always a tap, in both modes:** sends, withdrawals, bridges, token launches, approvals to a
  spender outside the registry, anything over a cap, any intent from an outside-content turn
  ([rule 13](#rule-13)), and every proposal from an MCP client.
- Switching to auto is a loosening ([decision 0089](DECISIONS.md#d0089)); switching back to manual
  is braking and instant.

**Confirmations.**

- The first answer wins, and the other surface's buttons are cleared.
- The message becomes a receipt, with the transaction hash and a BscScan link.
- Every line of a card, in English and Chinese, is in spec 4
  ([the swap card in full](specs/cards-and-messages.md#section-3-2)).

**Send levels ([decision 0016](DECISIONS.md#d0016))** limit where funds can leave to. Swaps and DeFi
always pay the agent's own wallet, at every level. A bridge is a cross-chain send
([decision 0067](DECISIONS.md#d0067)): it pays an address-book entry or the rescue address on the
other chain, under the same send level as a send.

Since [decision 0091](DECISIONS.md#d0091), every send goes to the rescue address or a saved address
(spec 5, section 4); the levels below choose among the saved ones.

| Level            | Sends and withdrawals                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| 0 Open (default) | Any address, with a tap                                                                                    |
| 1 Known          | Address-book entries with a tap; a new address needs the CLI or the console                                |
| 2 Cooled book    | Address-book entries only; a new entry becomes usable 24 hours after it is added in the CLI or the console |
| 3 Locked         | No sends; funds only move between the agent's own positions                                                |

- Moving to a stricter level is instant.
- Moving to a looser level takes 24 hours, can be cancelled, and is announced on every surface, so a
  hijacked Telegram account cannot quietly open a locked wallet.

**Limits** are set per agent and hold even with a tap:

- per-transaction and rolling 24-hour USD caps ([decision 0046](DECISIONS.md#d0046));
- a gas reserve that trades never spend ([decision 0045](DECISIONS.md#d0045));
- maximum tax and maximum slippage;
- allowed venues;
- token allow and deny lists;
- a minimum health factor.

**Kill switch.** `/freeze` in Telegram (no LLM involved), a console button or `binference freeze`.
In one transaction, it:

- marks the agent, or every agent in the install, as frozen;
- cancels pending cards and intents;
- aborts running turns;
- pauses auto orders;
- confirms on every surface.

Unfreezing needs the CLI or the console ([rule 11](#rule-11)).

**Rescue ([decision 0044](DECISIONS.md#d0044)).** Onboarding asks for a rescue address: the owner's
own main wallet. `/rescue` in Telegram or the Mini App, a console button or `binference rescue`
builds one intent that sends every token and the BNB (minus gas) of every agent wallet to that
address. One tap confirms it. It works at every send level and while frozen, and it never sells.
Changing the rescue address takes 24 hours, can be cancelled, and is announced on every surface, so
a hijacked Telegram account cannot redirect it.

<a id="section-12"></a>

### 12. Telegram

`@binference/telegram` runs in the engine, on grammY.

- **Setup.**
  - `binference init` takes the BotFather token and prints a `t.me/<bot>?start=<code>` link.
  - The first DM carrying that code makes that Telegram user the owner. Only numeric user ids are
    ever trusted.
  - Long polling runs in a worker thread, with each update stored before it is acknowledged. A lease
    keeps it to one poller per token.
  - Webhooks are optional; they require a secret checked in constant time, or the engine refuses to
    start.
- **Several agents.** Each agent gets its own topic in the owner's DM with the bot (Bot API topics
  in private chats). `/use <agent>` is the fallback.
- **Fast commands** (no LLM): `/balance`, `/positions`, `/orders`, `/cancel`, `/freeze`, `/rescue`,
  `/paper`, `/agents`, `/use`, `/limits`, `/status`, `/spend`, `/ai`, `/clear`, `/schedules`,
  `/console` (opens the Mini App, [section 25](#section-25)), `/lang`, `/help`. They are registered
  with `setMyCommands` in English and Chinese (`language_code`).
- **Cards and buttons.**
  - Typed actions are rendered as inline keyboards.
  - Callback data is `bnf1:<kind>:<decision>:<ref>`, within 64 bytes, with an opaque reference.
  - The presser is authorized against the owner inside the engine.
  - `answerCallbackQuery` is sent right after the durable write.
- **Formatting.** Messages use Telegram's HTML formatting; every value from outside (token names,
  model text) is escaped ([rule 3](#rule-3)).
- **Chat.** The engine relays the owner's messages to the agent runtime and sends its replies.
  Streaming is one status message edited in place (about once a second), then the final answer as a
  new message, because edits do not notify and results must.
- **Rate limits.**
  - One throttler per bot token owns every 429 wait. Previews are dropped; cards and results are
    retried.
  - Pasted text is batched within 300 ms.
- **Safety.**
  - A message that looks like a private key or a 12- or 24-word seed phrase is deleted at once,
    never stored, and answered with a warning.
  - Groups are off by default. When they are on, group messages, forwards, `via_bot` and
    anonymous-admin posts are never treated as the owner, and account details never go to a group.
- **Language** comes from the owner's choice, otherwise Telegram's `language_code` (`zh*` means
  Chinese).

<a id="section-13"></a>

### 13. The console

Decided in [decision 0017](DECISIONS.md#d0017).

`@binference/console` is built with React, Vite and shadcn, under MIT (the stack is in
[ENGINEERING.md section 24](ENGINEERING.md#section-24)). It compiles to static files that the engine
serves on localhost. It wears the bInference brand, flat ([decision 0070](DECISIONS.md#d0070)): ink
and gold, Hanken Grotesk, the Hermes mark, light and dark, no shadows or gradients, thin line icons,
and gain and loss colors that stay readable for color-blind owners.

- **Screens:**
  - chat, confirmations, portfolio and P&L, orders, the activity ledger;
  - agents, wallets, limits and send level, paper or live;
  - skills, plugins, checks, logs.
- **Sign-in.** `binference console` prints a single-use link, valid for 10 minutes. Each browser
  then holds a device key that the engine has paired; paired devices get the `confirm` and `admin`
  scopes.
- **More screens (decisions [0049](DECISIONS.md#d0049), [0053](DECISIONS.md#d0053),
  [0055](DECISIONS.md#d0055)):** model usage and budget, schedules, webhook rules, backups.
- **Telegram Mini App (decisions [0050](DECISIONS.md#d0050), [0052](DECISIONS.md#d0052)).** The same
  console opens inside Telegram through `/console`, with the power of a Telegram tap
  ([section 25](#section-25)).
- **Remote access** goes through Tailscale (`binference expose`, [section 25](#section-25)) or an
  SSH tunnel. The engine refuses to bind beyond loopback without auth.
- **Same protocol as everyone else.** The console uses `@binference/client` like every other client,
  so any other front end, a hosted one included, can be built on the same methods.

<a id="section-14"></a>

### 14. Plugins and MCP

**Plugin kinds:**

- `venue`: quotes, builds, decodes and reads positions for one protocol.
- `data`: read-only market or risk data.
- `surface`: a chat surface.
- `skills`: a skill pack.
- `provider`: an LLM provider.

Each declares, in a `binference` field of its `package.json`:

- its id, version and kind;
- the tools it adds;
- the contracts it touches, with their chain ids;
- the hosts it calls;
- its config schema.

```ts
interface VenueAdapter {
  id: string;
  contracts: Address[]; // declared; each must be in the registry
  quote(req: QuoteRequest): Promise<Quote>;
  build(intent: Intent, quote: Quote): Promise<UnsignedTx[]>;
  decode(tx: UnsignedTx): DecodedEffect; // the engine checks it against the intent
  positions?(wallet: Address): Promise<Position[]>;
}
```

**Trust tiers:**

| Tier      | Who                        | May                      | Runs                                                                                                                              |
| --------- | -------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Core      | Bundled, reviewed by us    | Build transactions, read | In the engine                                                                                                                     |
| Verified  | Reviewed publisher, signed | Build transactions, read | In the engine; output decoded, checked and simulated                                                                              |
| Community | Anyone                     | Read data, add skills    | A separate process under Node's permission model, no network of its own, fetch through the engine to declared hosts only, no keys |

v1 ships the Core and Community tiers. The Verified tier arrives with the plugin registry in v2.

**The community sandbox ([decision 0092](DECISIONS.md#d0092)).** Each community plugin runs in its
own Node 26 process with `--permission`: file reads only inside its own folder, no writes outside
its data folder, no child processes, no workers, no native addons, and no network of its own. Node
26 refuses fetch, TCP and DNS without `--allow-net`, but that flag is all or nothing (tested
2026-10-06 on 26.10), so a plugin reaches its declared hosts only through a fetch the engine hands
it over the plugin's IPC channel, which checks each request's host against the plugin's declaration.
Also:

- every engine process starts with `--disable-sigusr1`, so a plugin cannot open the engine's
  debugger;
- plugin processes start with `--no-experimental-sqlite`, because `node:sqlite` ignores the file
  grant;
- the install step refuses symlinks inside a plugin;
- the Docker image and the hardened setup run plugins as their own OS user, the only thing that
  stops a plugin from signalling the engine.

Installs are protected three ways:

- **Pinned.** Each install is pinned by hash in a lockfile.
- **Consent on widening.** An update whose manifest widens the declared surface asks for consent
  again.
- **Signatures checked.** Publisher signatures are verified locally.

**MCP server.** `binference mcp` is a stdio MCP server that connects to the engine with a `read` and
`propose` token. Claude Code, Codex, Cursor or any MCP client can then quote, check risk and
propose. Every proposal waits for the owner's tap in binference's Telegram or console.

**Own vocabulary ([decision 0074](DECISIONS.md#d0074)).** binference uses its own names for every
file, command, config key, protocol name, tool and term ([GLOSSARY.md](GLOSSARY.md)). Users of other
agent frameworks connect through the MCP server like any MCP client
([decision 0076](DECISIONS.md#d0076)).

<a id="section-15"></a>

### 15. The Binance Agent OS plugin

Decided in [decision 0006](DECISIONS.md#d0006).

- **What it is.** Binance's MCP server at `https://agent.binance.com/mcp/agentic`, using Streamable
  HTTP and OAuth with PKCE (no client secret).
  - The owner approves the agent on Binance's own consent page.
  - The agent trades only a separate "Agentic" sub-account, which the owner funds by hand.
  - There is no withdrawal scope.
  - The owner can disconnect it, or press Emergency stop, on binance.com.
- **How it connects.** An MCP client in `plugins/binance-agent-os` built on
  `@modelcontextprotocol/sdk`.
  - It identifies itself with a Client ID Metadata Document, hosted at a fixed HTTPS address that
    binference.io serves. Binance's server supports these documents and has no open registration.
  - Each install redirects to `127.0.0.1`.
  - Tool names are mapped onto our `cex_*` tools, and their schemas are pinned and tested.
- **Gate.** Binance documents only named clients (Claude Code, Codex, ChatGPT, VS Code, Grok), and
  says "contact support" for others, so Binance must accept binference as a client first. The real
  tool list is recorded with a test account. No refresh token is advertised, so a "reconnect
  Binance" message is part of the design.
- **If Binance says no,** the owner connects Binance's MCP in their own Claude Code and uses
  binference's MCP server beside it. Pasted API keys are never accepted.
- **Our own checks on top.** Every `cex_order` gets a binference card and our caps. Futures and
  margin stay off until the owner turns them on, with a leverage cap.

<a id="section-16"></a>

### 16. Models

Decided in [decision 0007](DECISIONS.md#d0007).

- **Default: the binference AI gateway,** in the OpenAI Chat Completions or Anthropic Messages
  format. `binference init` gets a `binf_` key through the device-code link, with a spending limit
  the owner picks.
- **Any provider allowed.** Any OpenAI- or Anthropic-compatible provider works instead, local models
  included.
- **Roles:**
  - `main` talks and proposes.
  - `fast` handles summaries, compaction and classification.

  The defaults are picked by evaluation ([section 19](#section-19)), and they stay configurable.

- **Rules:**
  - Keep `max_tokens` modest, because the gateway reserves it for each call.
  - Keep the prompt prefix stable, for caching.
  - Model fallback is allowed only before a propose tool has run in the turn.
  - An explicit model choice by the owner is never swapped.
- **Fallback chains.** Each role has an ordered list of models. A failing provider gets a cooldown;
  a model request with no output for 120 seconds is aborted.
- **Images ([decision 0050](DECISIONS.md#d0050)).** A separate vision model (`models.vision`) reads
  images only when the main model cannot.
- **Cost** is guarded as [section 26](#section-26) describes.

<a id="section-17"></a>

### 17. Storage

- **One backend in v1, one contract ([decision 0031](DECISIONS.md#d0031)).** The store is a set of
  ports. v1 ships SQLite only, on `node:sqlite` (built into Node, nothing to compile) with Kysely
  through a synchronous dialect. Database work runs on worker threads. A Postgres adapter comes with
  the cloud plan and must pass the same contract test suites.
- **Two databases.** The engine and the agent runtime keep separate ones ([section 3](#section-3)).
- **Short transactions for money.** Plan first, re-read the authoritative rows, write and commit. No
  network call happens inside a transaction.
- **One writer per database.** SQLite hands the write lock over unfairly (one write waited 467 ms
  behind 8 busy writers), so each database has one writer behind a queue; reads run on workers. The
  busy timeout is set in the `DatabaseSync` constructor, before the WAL pragma.
- **Versions.** Each database carries a schema version; an older binference refuses to open a newer
  database.
- **Backups and retention.** Daily encrypted snapshots and one before every update or migration
  ([decision 0055](DECISIONS.md#d0055), [section 24](#section-24)). Chats older than 90 days are
  deleted ([decision 0056](DECISIONS.md#d0056)); the ledger, orders and memory stay.

Engine tables:

- `wallets`, `nonces`
- `intents`, `intent_events`, `confirmations`
- `txs` (raw bytes, hash, nonce, relays, status)
- `orders`, `order_fills`, `positions`
- `ledger` (append-only, hash-chained, never pruned)
- `limits`, `send_levels`, `address_book`
- `risk_cache`, `alerts`
- `inbox`, `outbox`, `audit_events`, `plugins`
- `config_journal`, `webhook_rules`, `prices`

Agent runtime tables: `agents`, `sessions`, `transcript_events`, `memory_items`, `skills`,
`schedules`, `model_usage`.

<a id="section-18"></a>

### 18. Security model

| Threat                                                         | Controls                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection (token names, tweets, web pages, group chats) | Every transaction needs a tap collected by the engine; cards drawn from the intent; swaps pay the own wallet; outside-content warning on cards; order fills stay inside the confirmed bounds                                                                                                                                      |
| Telegram account takeover                                      | Daily caps; opt-in send levels with 24-hour loosening; freeze from anywhere, unfreeze only from the CLI or console; alerts on every surface; small dedicated wallets. **At the default level a hijacked Telegram can send the agent wallet's funds anywhere (decisions [0015](DECISIONS.md#d0015), [0016](DECISIONS.md#d0016)).** |
| Malicious plugin or skill                                      | No third-party code in the engine; the community tier is sandboxed and read-only; pinned hashes, consent on widening, signature checks; skills cannot add tools                                                                                                                                                                   |
| A compromised agent runtime (exec tools on, a bad skill)       | It holds only `read`, `propose` and `chat`; it cannot approve, sign or change settings                                                                                                                                                                                                                                            |
| Key theft                                                      | Wallet keys only in Privy; the agent key only in the signer process (and optionally its own OS user), unlocked from the OS keychain or an owner-only file; the Privy policy as the ceiling                                                                                                                                        |
| Honeypots, hidden taxes, rugs                                  | Round-trip simulation from fresh addresses, GoPlus, honeypot.is, launchpad mode decode, maximum tax, fail closed                                                                                                                                                                                                                  |
| MEV                                                            | Private relays only, a tight minimum out from simulation, 60-second deadlines                                                                                                                                                                                                                                                     |
| Double spends, stuck nonces                                    | One writer per wallet, raw transaction stored before broadcast, recovery by hash and nonce                                                                                                                                                                                                                                        |
| Fake addresses from the model or memory                        | Registry only for contracts; pasted tokens go through the risk check; checksummed display                                                                                                                                                                                                                                         |
| Permit and 7702 phishing                                       | No blind signatures, no 7702 authorizations                                                                                                                                                                                                                                                                                       |
| Forged callbacks and webhooks                                  | Opaque callback refs, presser authorized in the engine, constant-time webhook secret                                                                                                                                                                                                                                              |
| A seed or key pasted into chat                                 | Deleted at once, never stored; redaction patterns for `0x` + 64 hex and BIP-39 phrases in every log                                                                                                                                                                                                                               |
| An exposed engine                                              | Loopback by default; refuses to start beyond loopback without auth; scoped tokens; device pairing                                                                                                                                                                                                                                 |
| A bad venue (exploits, malicious hooks)                        | Venue allowlist, PancakeSwap Infinity hooks allowlisted, health-factor floor, per-venue switches                                                                                                                                                                                                                                  |

`binference check security` lists its findings with stable check ids. It checks, among other things:

- the webhook secret is set;
- no wildcard owner exists;
- the engine is not exposed without auth;
- approvals expire with their quotes;
- redaction is on;
- private relays are configured.

The engine refuses to start on insecure combinations, and risky switches are named `dangerously*`.

<a id="section-19"></a>

### 19. Observability, evaluation and audit

- **The ledger.** It records every intent, decision, card, tap (who and where), signature hash,
  relay, receipt and fill. It is hash-chained and exportable as CSV. An optional daily anchor of the
  chain's head on BSC comes later.
- **Logs** never hold keys, seeds or prompts. OpenTelemetry is optional.
- **`binference check`** checks:
  - config migrations, so an old key never stays behind as a silent alias;
  - store integrity;
  - RPC and relay reachability, and model reachability;
  - Telegram health;
  - that the signer is alive.
- **Agent evaluation.** About 100 scenarios, run against a mock venue and a BSC fork for each
  candidate model, before a model becomes a default, and nightly in CI. They test that the agent:
  - turns plain language, in both languages, into the right intents;
  - refuses to send funds nobody asked to send;
  - ignores instructions planted in token names and web pages;
  - never invents addresses;
  - reports failures truthfully;
  - does nothing when no tool fits.

  The bar: 100% on the safety scenarios (no unasked sends, no invented addresses, planted
  instructions ignored) and at least 90% on understanding requests, in each language. A model change
  needs both.

<a id="section-20"></a>

### 20. The hosted version

bInference Cloud, the hosted version, is described in [section 30](#section-30).

<a id="section-21"></a>

### 21. Chain-agnostic core

Decided in decisions [0022](DECISIONS.md#d0022) and [0023](DECISIONS.md#d0023).

- **Standard ids.** Chains, accounts and assets are CAIP strings: `eip155:56` (CAIP-2),
  `eip155:56:0x…` (CAIP-10) and `eip155:56/erc20:0x…` (CAIP-19). They are branded types parsed in
  `@binference/chain`.
- **Families and chains.** A chain family implements the `ChainFamily` and `SigningScheme` ports
  (accounts, transfers, approvals, fees, simulation, broadcast, watching, decoding, transaction
  ordering). A chain is a data file in `@binference/chains` that names its family.
- **What changes where.**
  - Another EVM chain (Base, opBNB): a file in `chains`, its venue addresses and its fork tests.
  - Solana: a `chain-solana` package that passes the family contract suites.
  - Neither touches `engine`, `signer` or `protocol`.
- **v1 enables BSC only.** The engine, the signer and the policy never contain a chain literal; a
  check script enforces it.

<a id="section-22"></a>

### 22. Operating-system layer

Decided in decisions [0024](DECISIONS.md#d0024) and [0039](DECISIONS.md#d0039).

`@binference/platform` hides every OS difference behind ports
([ENGINEERING.md section 2.5](ENGINEERING.md#section-2-5)):

- state folder `~/.binference` on every OS;
- secrets in the OS keychain (Keychain, Credential Manager, Secret Service) through
  `@napi-rs/keyring`, with a passphrase fallback. On Linux the Secret Service is required: the
  library otherwise falls back silently to the kernel keyring, which forgets everything at reboot.
  On Windows, Credential Manager does not work in network logons, so the scheduled task runs only
  while the user is logged on; on macOS the LaunchAgent runs in the user's session;
- the background service through `launchctl`, `systemctl --user` or `schtasks`;
- IPC over a Unix socket, or a named pipe on Windows;
- owner-only file permissions (POSIX modes, or an ACL on Windows);
- one shutdown sequence for POSIX signals and Windows stop events.

Every CI check runs on Linux, macOS and Windows.

<a id="section-23"></a>

### 23. Wallet safety and accounting

Decided in decisions [0043](DECISIONS.md#d0043) to [0046](DECISIONS.md#d0046),
[0058](DECISIONS.md#d0058) and [0059](DECISIONS.md#d0059).

- **Recovery.** The wallets live in Privy ([decision 0085](DECISIONS.md#d0085)). Self-hosted, the
  owner key brings them back on any machine; onboarding shows it once, asks for its last 6
  characters back, and refuses to continue until they match. Cloud, the user's bInference sign-in
  does.
- **Rescue.** The rescue address and `/rescue` ([section 11](#section-11)).
- **Gas reserve.** Policy refuses any trade that would leave a wallet with less than its reserve
  (default 0.002 BNB, about 250 swaps of gas). Below twice the reserve the owner gets a low-gas
  alert. A stop-loss is never starved by an earlier buy.
- **Rolling caps.** Caps sum the USD value of every outgoing trade and send in the last 24 hours.
- **USD values.**
  - BNB: Chainlink's BNB/USD feed on BSC (the 8-decimal one), read on chain, keyless, refused when
    older than that feed's heartbeat plus a margin.
  - Stablecoins: $1, unless that feed or a stablecoin feed shows a depeg beyond 2%.
  - Other tokens: the trade's own quote into BNB or USDT.
  - No price means the trade is refused. DEX Screener is a cross-check only.
- **P&L.** Average cost per position; swap fees and gas are part of the cost; realized and
  unrealized P&L in USD at the time of each fill. `binference ledger export` writes a CSV of every
  fill for tax tools.

<a id="section-24"></a>

### 24. Running the engine

Decided in decisions [0047](DECISIONS.md#d0047), [0048](DECISIONS.md#d0048),
[0055](DECISIONS.md#d0055) and [0062](DECISIONS.md#d0062).

- **One engine per state folder.** An OS file lock in `~/.binference`; a second engine refuses to
  start, because two engines would race on nonces.
- **Startup order.** Lock, config, migrations (after a backup), integrity check, signer, reconcile
  unfinished transactions by hash and nonce, resume orders and watchers, then channels and the
  server. Until then every method answers "starting".
- **Shutdown order, within 30 seconds.** Stop accepting intents, finish signing and broadcasts in
  flight, save state, stop channels, close the databases.
- **`binference check`** adds SQLite integrity checks and maintenance, `--fix` repairs, and a health
  contract.
- **Commands.** `status`, `health`, `logs`, `report` (a redacted support bundle), `backup create`,
  `backup restore`, `update`, `expose`, `uninstall`, `reset`.
- **Config journal.** Every change to settings or limits is recorded (who, where, before, after) and
  announced on every surface.
- **Live settings** reload without a restart; onboarding has a non-interactive mode for Docker and
  VPS installs.
- **Backups ([decision 0055](DECISIONS.md#d0055)).** An encrypted snapshot through SQLite's backup
  API every day (7 daily and 4 weekly kept), and one before every update and migration. Live
  database files are never copied. An optional second copy goes to a folder the owner picks.
- **Updates ([decision 0047](DECISIONS.md#d0047)).** A daily check, on by default, asks whether a
  newer version exists and sends the version, OS, Node version and CPU type. A new version arrives
  as a Telegram note with its changes. `binference update` backs up, verifies the npm provenance,
  installs, runs `check`, and restores the previous version if `check` fails. Nothing installs by
  itself.
- **Telemetry ([decision 0048](DECISIONS.md#d0048)).** Off by default; onboarding asks once. When
  on, it adds counts to the daily check: version, OS, enabled venues and plugins, paper or live,
  number of agents. Never addresses, balances, amounts, tokens, chats or keys. The totals are
  published.
- **Proxy.** An outbound HTTP proxy setting (`core/src/proxy/`), for owners who need one to reach
  Telegram or model providers.
- **Health signals** in `status`: event-loop lag, memory, RPC and relay health, model reachability.
- **Targets.** Runs on 1 vCPU and 1 GB RAM; idle memory under 300 MB; a card within 2 seconds of a
  proposal (risk APIs excluded); an auto-order trigger broadcast within 1 block.

<a id="section-25"></a>

### 25. Remote access: Mini App, webhooks and terminal chat

Decided in decisions [0050](DECISIONS.md#d0050) to [0053](DECISIONS.md#d0053).

- **Publishing ([decision 0051](DECISIONS.md#d0051)).** `binference expose` configures Tailscale.
  The Mini App uses `serve`, so only the owner's devices running Tailscale reach it. Inbound
  webhooks use `funnel`, and only the webhook path is public, on a listener separate from the
  engine's own port, which stays on loopback. `binference check` verifies both.
- **Mini App ([decision 0052](DECISIONS.md#d0052)).** `/console` sends a button that opens the
  console inside Telegram. The engine verifies Telegram's signed `initData` against the bot token,
  rejects missing, expired or replayed data, and accepts only the owner's numeric id. The Mini App
  has the power of a Telegram tap: view, confirm, cancel, freeze, rescue. Settings, looser limits,
  unfreeze and wallet export are not shown there.
- **Webhook rules ([decision 0053](DECISIONS.md#d0053)).** The owner creates a rule in the console
  or the CLI: the alert's name, the action and its bounds (token, side, size, worst price, maximum
  slippage, expiry, maximum fills). The rule is confirmed once with a card, like an auto order
  ([decision 0004](DECISIONS.md#d0004)). Each rule has its own secret URL. An alert fills inside the
  rule's bounds with no model involved, then notifies. Repeated alert ids and alerts above the
  rule's rate are dropped.
- **Terminal chat ([decision 0050](DECISIONS.md#d0050)).** `binference chat` runs terminal chat from
  the `tui` package, with the CLI's rights.
- **Images ([decision 0050](DECISIONS.md#d0050)).** The owner may send a picture in Telegram, the
  console or the TUI. It reaches the model (or the vision model), and the turn is marked as outside
  content ([rule 13](#rule-13)). Size and count limits apply.

<a id="section-26"></a>

### 26. Model use and cost

Decided in [decision 0049](DECISIONS.md#d0049).

- **Usage.** `/spend`, `/status` and a console view show tokens and estimated cost per reply, per
  day and per model, from the provider's usage data and a local price table.
- **Budget.** Each agent has a daily model budget (default $3). When it is spent, chat pauses until
  the next window and the owner is told; auto orders, watchers and webhook rules keep running,
  because they are code. The gateway key's own spending limit stays as a second guard.
- **Loops.** Loop detection is on by default: the same tool with the same arguments and the same
  result three times ends the turn. A turn makes at most 25 tool calls.
- **Schedules.** "Every morning, review my portfolio" in chat creates a schedule through
  `schedule_create`: no money, no tap, owner timezone. `/schedules` lists them, and each run counts
  toward the budget.
- **Search.** `search_web` uses DuckDuckGo with no key by default; other providers take keys.
  `search_x` needs an X API key.

<a id="section-27"></a>

### 27. Install, onboarding and notifications

Decided in decisions [0054](DECISIONS.md#d0054), [0057](DECISIONS.md#d0057),
[0060](DECISIONS.md#d0060) and [0061](DECISIONS.md#d0061).

- **Install ([decision 0054](DECISIONS.md#d0054)).**
  `curl -fsSL https://binference.io/install.sh | sh` and a PowerShell one-liner install Node 26 when
  it is missing, then the npm package, then start onboarding. The scripts are published with
  checksums. `npm i -g binference` and a Docker image are the other paths.
- **Onboarding, in order:** language; disclaimer and privacy statement, accepted by typing "I
  understand" ([decision 0060](DECISIONS.md#d0060)); telemetry consent
  ([decision 0048](DECISIONS.md#d0048)); the model (device-code link or any provider); the Privy app
  and the owner key, shown once and confirmed ([decision 0085](DECISIONS.md#d0085)); the rescue
  address ([decision 0044](DECISIONS.md#d0044)); the Telegram bot and owner pairing; limits, gas
  reserve and send level; the service; paper mode.
- **Disclaimer ([decision 0060](DECISIONS.md#d0060)).** Not financial advice; the owner is
  responsible for every confirmed trade; the software is MIT "as is". The privacy statement lists
  what leaves the machine: the model provider sees chats and balances, RPCs see the IP address, risk
  APIs see token addresses, the update check sends the version and OS.
- **First chat ([decision 0061](DECISIONS.md#d0061)).** In paper mode the agent asks about 8 short
  questions in the owner's language (budget, holding time, sectors, exits, when to ask) and writes
  `STRATEGY.md` and `PERSONA.md`, editable later. Limits come only from onboarding, the CLI and the
  console.
- **Notifications ([decision 0057](DECISIONS.md#d0057)).** By default: every fill; every failed or
  skipped fill; low gas; orders about to expire; security events (freeze, rescue, a new device, a
  send-level, limit or rescue address change, a plaintext secret found); a daily summary at 09:00
  owner time. No quiet hours by default. Each is configurable per agent.

<a id="section-28"></a>

### 28. Specifications and defaults

Decided in decisions [0064](DECISIONS.md#d0064) and [0071](DECISIONS.md#d0071) to
[0073](DECISIONS.md#d0073).

**When this page, the specs and the engineering rules are silent,** engineers follow the nearest
rule. If the question is still open, they write a short decision record and get the maintainers' yes
before coding. A choice is never made at random
([ENGINEERING.md principle 9](ENGINEERING.md#section-1)).

**Six specs came before their code.** Each lives in `docs/specs/` and was accepted before its code
was written:

1. [the protocol](specs/protocol.md): operations, pushes, errors, scopes and versions;
2. [the config file](specs/config.md), with every default;
3. [the database schemas](specs/database.md) of the engine and the runtime;
4. [the cards and messages](specs/cards-and-messages.md), in both languages;
5. [the keys, unlocking, signing and backups](specs/keys-and-backups.md);
6. [the intent state machine](specs/intent-states.md), with every transition and terminal state.

**Default limits for a new agent ([decision 0064](DECISIONS.md#d0064))**, all changeable per agent;
onboarding shows the caps for the owner to confirm:

| Setting                       | Default                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Per-trade cap                 | $100                                                                                         |
| Rolling 24-hour cap           | $500                                                                                         |
| Maximum slippage              | 1% on registry tokens, 5% on other tokens                                                    |
| Maximum price impact          | 3%                                                                                           |
| Maximum token tax             | 10%                                                                                          |
| Unknown-token liquidity floor | $10,000 in the pool; tokens still on a launchpad curve skip it but pass simulation and tax   |
| Minimum health factor         | 1.5                                                                                          |
| Gas reserve                   | 0.002 BNB, low-gas alert below 0.004 BNB ([decision 0045](DECISIONS.md#d0045))               |
| Card expiry                   | 60 s for trades, 10 min for sends and DeFi                                                   |
| Re-quote at the tap           | When the quote is older than 10 s; a new card if the minimum out worsened by more than 0.5%  |
| Auto orders                   | Expire after 30 days unless set; limit, take-profit and stop-loss fill once                  |
| Copy-trade                    | Each leader buy copied at $20; sells mirror the share the leader sold; $200 a day per leader |
| Paper portfolio               | 1 BNB and 500 USDT ([decision 0069](DECISIONS.md#d0069))                                     |
| Model budget                  | $3 a day per agent ([decision 0049](DECISIONS.md#d0049))                                     |
| Send level                    | 0, Open ([decision 0016](DECISIONS.md#d0016))                                                |

**Execution defaults.** Gas price is the network floor (0.05 gwei) unless relay measurements need
more; there is no priority bidding in v1. Swaps go to the two fastest private relays, by
measurement, and never to the public mempool. Risk answers from GoPlus and honeypot.is are cached
for 10 minutes; our own simulation runs for every trade.

**`.bnb` names ([decision 0071](DECISIONS.md#d0071)).** A name resolves through SPACE ID at send
time; the card shows both the name and the resolved address, and the address book stores the
address.

**ERC-8004 identity ([decision 0071](DECISIONS.md#d0071)).** Opt-in per agent.
`binference agent identity` registers the agent in BSC's ERC-8004 identity registry with one tapped
transaction. The agent's card (name, description, accounts, binference version) is stored on chain
as a data URI, so nothing needs hosting. Reputation and validation registries come later.

<a id="section-29"></a>

### 29. Binance Agents

Decided in [decision 0080](DECISIONS.md#d0080).

Owners already run agents on Binance Agent OS: a Claude Code or Codex session with Binance's MCP
server and the Agentic Wallet (`baw`). bInference connects to them and manages them; it never takes
their keys, and Binance still does their trading. The model is show, limit, stop and prove, in a
self-hosted engine.

- **Connect.** `binference agent connect binance` installs small hooks into the folder where the
  Binance agent runs. They report each trade to the engine over the local IPC endpoint, and the
  engine lists the agent beside its own agents.
- **See.** A timeline per agent: what was traded, the amount, the price, the order id, the
  transaction hash and how it ended. Actions only, never prompts or chat.
- **Limit.** Per-agent daily spend, token allow and deny lists, and a per-trade cap, enforced by the
  hook before each trade tool runs (it refuses an over-limit call). Binance's own wallet rules stay
  in the Binance App and are shown read-only.
- **Pause and stop.** Pause makes the hook refuse new trades; stop also disconnects the agent. Both
  work from Telegram, the Mini App, the console and the CLI, at once ([rule 11](#rule-11)'s
  braking).
- **Prove.** A track record per agent, each trade matched to Binance's order history or the chain,
  exportable as CSV.
- **Alerts** go through the same notices as the engine's own fills ([section 27](#section-27)).

A seventh spec, `specs/binance-agents.md`, will detail the hooks, the report format and the timeline
before their code starts.

<a id="section-30"></a>

### 30. Two profiles: self-hosted and bInference Cloud

Decided in decisions [0086](DECISIONS.md#d0086) and [0087](DECISIONS.md#d0087).

One agent, two ways to run it, both in v1. They share every public package and the protocol. What
differs is which adapter fills each port, and only the composition root decides that
([rule 19](#rule-19)): `cli` builds the self-hosted profile; the Cloud worker's entry file builds
the Cloud profile. A port with two adapters runs one contract test suite against both.

| Part             | Self-hosted: the owner provides                                                        | Cloud: our systems provide                                                      |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Custody          | Their own Privy app; the owner key offline; the agent key in the signer process        | Our Privy app; the wallet in the user's Privy account; our signer service (KMS) |
| Telegram         | Their own BotFather bot, long polling                                                  | Our official bot, webhook ingress into Postgres; one DM topic per agent         |
| Models           | A bInference Router link (default) or any compatible provider key                      | The user's bInference AI credit                                                 |
| RPC              | Public BNB Chain RPCs (default) or their own provider keys                             | Our RPC pool                                                                    |
| Store            | SQLite (`node:sqlite`)                                                                 | Postgres, the same store ports and contract suites; one lease per agent (below) |
| Secrets          | OS keychain, owner-only file or a secret command ([decision 0065](DECISIONS.md#d0065)) | KMS and the platform's secret store                                             |
| Process model    | Engine, runtime and signer processes on one machine                                    | Shared workers running `engine` and `runtime`; a separate signer service        |
| Console          | The open-source console on localhost, and the Mini App over Tailscale                  | The binference.io console (closed source)                                       |
| Remote access    | Tailscale `serve` and `funnel` ([decision 0051](DECISIONS.md#d0051))                   | Not needed: the console and webhooks live on binference.io                      |
| Binance Agent OS | OAuth back to `127.0.0.1`                                                              | OAuth back to binference.io, one encrypted token per user                       |
| Backups, updates | Local encrypted backups; `binference update`                                           | Managed database backups; we deploy                                             |

**Rules for both profiles:**

- Every profile-dependent part is a port in a public package. Ports never mention a profile.
- Self-hosted defaults work with the fewest keys ([rule 16](#rule-16)); `binference init` walks the
  owner through each key with links and checks it on the spot.
- Cloud-only code lives outside the public repo: the worker entry and the workers, the signer
  service, the official bot's ingress, billing and the console. The Postgres store adapter is
  public, so self-hosters can use it too.
- Any change to a port names both adapters in its PR, and both pass its contract suite.

**What Cloud adds:**

- **Workers.** Node workers run `@binference/engine` and `@binference/runtime` over the Postgres
  store. Each agent is held by one worker through a lease row (agent, worker, fence, expiry),
  renewed every few seconds; every write carries the fence, so a worker that lost its lease cannot
  write. Cloud agents get no shell, file or browser tools.
- **Signer service.** The only holder of our Privy authorization key, in KMS. It runs the same hard
  rules as the self-hosted signer and signs with `eth_signTransaction`; the worker broadcasts through
  private relays. Owners can export their key or remove the bInference signer at any time.
- **Separate database roles** for the workers, the ingress API and the signer service. A worker
  cannot insert a confirmation, so a compromised worker cannot approve its own transactions.
- **Official bot.** Updates arrive by webhook into an ingress table unique on `bot_id + update_id`.
  A signed-in user links Telegram with a single-use `start` token (15 minutes, only its hash stored,
  confirmed on both sides).
- **Market-data service.** Shared block, pool-price and wallet watchers fan out to the agents, so
  many orders on one token cost one subscription.
- **Ops.** Per-user rate limits and quotas; alarms to the operators' Telegram; a global breaker that
  freezes every Cloud agent; a status page.
