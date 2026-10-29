# Glossary

This page names every part of binference and gives each English term its Chinese. Every name in
code, files, commands, config, the protocol, tools, docs and the UI comes from here. Never borrow a
file name, command, config key, protocol name, tool name or term from another agent framework; add a
new name here first, in the change that uses it.

## Names

### Processes and surfaces

- **engine**: the long-running process that owns the money path, the Telegram bot, the protocol,
  auto orders and the store. It runs no model.
- **agent runtime**: the separate process that runs the model loop, sessions, context, skills and
  notes. It can only read and propose.
- **signer**: the child process that holds the agent key and checks the hard rules before every
  signature.
- **console**: the open-source web interface the engine serves on localhost.
- **Mini App**: the console opened inside Telegram with `/console`.
- **terminal chat**: chat in the terminal (`binference chat`), from the `tui` package.
- **MCP server**: `binference mcp`, which gives any MCP client the read and propose tools.
- **MCP setup**: `binference mcp setup`, which gives Claude Code or Codex a client token of its own,
  its MCP server entry and the `binference-tools` skill, and with `--remove` takes them back.
- **MCP session**: `binference mcp session`, which starts Claude Code or Codex once with the MCP
  server and a client token that expires and is revoked when the client exits. Not a **session**.
- **surfaces**: the places the owner reads cards and acts: Telegram, the console, the Mini App and
  the CLI.
- **composition root**: the one place, `cli/src/compose/`, that builds adapters and wires them in.
- **health signals**: what `binference status` reports about the running engine, each `ok`,
  `warn` or `fail`: event-loop lag, memory, the engine log, the executor's relays, custody and the
  chains' RPC nodes.
- **engine log**: `logs/engine.log` in the state folder, one JSON line per log record with ids
  and no content, set aside by size and read back by `binference logs`.
- **support bundle**: the JSON file `binference report` writes to `reports/` in the state folder for
  the owner to share when asking for help: versions, the config with secret sources by kind, the
  check's findings, the engine's status and the newest engine log lines, kept by field rules.
- **browser push**: a notification a console device's browser shows when a card opens or closes,
  sent through the browser's push service (Web Push) and encrypted to the browser; the owner turns
  it on in the console. The message names the card only.
- **push worker**: the console's service worker, `/push-worker.js`, which shows browser push
  messages and opens the console at the card.
- **VAPID key**: the engine's P-256 key pair that signs each browser push message, in
  `keys/web-push-vapid`; browsers subscribe with its public half.
- **CLI token**: the `bnt_` token in `auth/cli.token` that the CLI signs in with over IPC; the
  engine stores only its SHA-256.
- **client token**: a `bnt_` token a client signs in with over IPC, with its label, kind and
  scopes; the engine stores only its SHA-256. The CLI makes an MCP client's and registers its hash
  with `token/register`. A client token can have an expiry, after which it signs in no more.

### Money and safety

- **intent**: one action the owner may confirm, such as a swap, a send, a rescue or an order fill.
  One module moves it through its states.
- **card**: the message that shows an intent's terms on every surface, drawn from the stored intent.
- **card version**: the card's terms at one moment. A worse re-quote opens a new version, and a tap
  on an old one fails.
- **confirmation**: the owner's recorded yes to one card version.
- **receipt**: the card after it settles, edited to show the outcome.
- **card copy**: one message that shows a card version on a surface, such as the card in the
  owner's Telegram chat. The first answer turns every copy into the receipt.
- **callback reference**: the random 12 bytes a card version's buttons carry in place of any id,
  so a press names a card no one could guess.
- **card showing**: a card version as a button surface shows it, drawn from the stored intent with
  its callback reference and the assets it names.
- **auto order**: a limit, take-profit, stop-loss, trailing, DCA or copy-trade order, confirmed
  once, on the card of its `autoOrder` intent. Each fill runs inside its bounds without a card.
  While its agent is frozen it is **paused** and fills nothing.
- **exit order**: a take-profit, stop-loss, trailing stop or limit sell on a position. When one
  exit order sells the whole position, the position's other exit orders end.
- **place**: where a buy or sell runs: the token's launchpad curve while it is on one, else the DEX
  pools. The engine picks it; the card names it.
- **fill**: one execution of an auto order or a webhook rule.
- **watcher**: code that reads blocks, prices, leader wallets or launches and triggers fills. No
  model runs in it.
- **downtime**: a span the engine did not run: stopped, crashed, or paused while its machine slept.
  A start after it, or a jump of the wall clock while the engine runs, forward or back, is a
  **resume**; the **downtime re-check** then checks every auto order once on a price read after the
  resume and sends one **resume report** when it checked one.
- **price watcher**: the watcher that reads the price of every token with an active auto order at
  each new block, all in one batched call, and says how many blocks it trails the chain (its
  **lag**).
- **block source**: what hands the watchers each new block of a chain: a WebSocket subscription to
  new heads where config names one, else polling the chain's RPCs once a block time.
- **price read**: the calls a venue declares to price a token from the chain's state (a pool's
  reserves or price, a launchpad curve's price), and the pure step that turns their answers into
  the price. A token no venue prices is priced from its deepest Uniswap-style pool.
- **cross-check**: comparing the price watcher's prices with the market data sources' on a
  schedule; a price too far apart is flagged as a **gap**.
- **alert**: a price, wallet or launch condition that notifies and sends no transaction. An alert
  with **wake** also starts a turn of the agent when it fires.
- **launch feed**: the tokens the launchpads created, read from their create events by the launch
  watcher.
- **tracked wallet**: a wallet an active copy order or wallet alert names; the leader watcher reads
  its trades from each block.
- **webhook rule**: a rule confirmed once that lets an inbound webhook fill inside its bounds.
- **schedule**: a model turn that runs at set times. It moves no money.
- **paper mode**: real quotes, checks and cards, with fills recorded at the confirmed quote and
  nothing sent on chain. New agents start in it; **live** is the opposite.
- **paper fill**: the fill paper mode records when a paper intent is confirmed: the confirmed
  quote's input for its expected output, kept with the move to `paper_filled` and its ledger entry.
- **paper portfolio**: an agent's paper money, held as its wallets' paper positions with their own
  P&L. A **paper reset** starts it again from the starting balances, 1 BNB and 500 USDT by default.
- **live switch**: `agent/goLive`, the one step that moves an agent from paper to live. The **first
  live card** after it says that the trade uses real money.
- **approval mode**: per agent, **manual** (every transaction outside an auto order needs a tap; the
  default) or **auto** (buys, sells, swaps and moves inside the agent's own positions run within the
  caps without a tap).
- **auto grant**: what the signer checks before it signs a step of an intent the auto mode
  authorized: the intent, its terms hash, the approval mode version that authorized it, the network
  fee cap and when it expires. A switch of the approval mode ends every grant made under the old
  version.
- **limits**: the per-agent caps and lists the engine checks under the ceiling.
- **ceiling**: each wallet's Privy policy, the hard limit behind the limits. Only the owner key
  raises it.
- **24-hour caps** (`dayCaps`): the ceiling's rolling sums of the native coin every transaction
  sends and of each capped token's approvals, which every wallet of the install shares
  (decision 0149). Each is sized in dollars at its asset's **floor price**, such as $100 a BNB.
- **gas reserve**: the BNB a wallet keeps for network fees. Trades never spend it.
- **spendable balance**: what a buy order may spend of an asset: all of a token, and of the chain's
  coin what lies above the gas reserve (decision 0190).
- **wallet facts**: what the money path reads about an agent's wallets outside the store ports:
  which wallets the agent owns, the native balance (the paper balance in paper mode), the ceiling's
  cap per transaction, the fee per gas, the network fee cap and the agent's recent outflows.
- **price source**: what gives an asset's USD price now: Chainlink feeds for the native coin, the
  token that wraps it one for one, and the stablecoins, which count as $1 until their feed moves
  past 2%, and a trade's own quote for its other token. A stale feed or an asset with neither has
  no price, and the trade is refused.
- **network fee cap**: per chain, the most fee per gas a transaction pays without the owner's tap
  (`chains.maxFeePerGasGwei`). A higher fee opens a card.
- **owner key**: the key that owns the wallets and their policy. It is shown once as a `bnok1` code
  and kept offline.
- **owner-key operation**: an operation whose args carry the owner key code, such as `ceiling/set`.
  The engine takes it over IPC only, from a shell on the machine.
- **agent key**: the key the signer holds on one machine. It can ask for signatures inside the
  ceiling only.
- **key quorum**: Privy's record of the keys that act for a wallet or a policy. binference makes
  one for the owner key, which owns each wallet and its ceiling, and one for the agent key, each
  wallet's one added signer.
- **authorization signature**: the agent key's P-256 signature over one Privy request, which Privy
  checks before it signs a transaction.
- **read-back**: reading a new wallet back from Privy and refusing it unless its owner, its signer
  and its ceiling are exactly what was asked.
- **rescue address**: the owner's own wallet, where a rescue sends everything. Changing it takes 24
  hours.
- **saved address**: an address saved in the ceiling with the owner key. Sends go only to saved
  addresses and the rescue address.
- **address book**: the agent's saved addresses with their labels.
- **send level**: from 0 (Open) to 3 (Locked), where sends may go among the saved addresses.
- **freeze**: stops an agent or the whole install at once; an agent created while the install is
  frozen starts frozen. Unfreezing is asked for in the CLI, the console or the Mini App, and takes
  the owner's tap on its card.
- **rescue**: one intent that moves every token and the BNB of every agent wallet to the rescue
  address, even while frozen.
- **braking** and **loosening**: a change that makes the agent safer works at once; one that makes
  it less safe needs the CLI, the console or the Mini App.
- **hard rules**: the checks the signer runs itself before it signs.
- **wallet queue**: the queue per wallet, one transaction at a time, that owns the nonce, signs and
  sends.
- **lowest free nonce**: the rule the wallet queue gives nonces by: the lowest nonce the chain has
  not used that no signed or sent transaction of the wallet holds. A nonce never signed, or freed by
  a dropped transaction, goes to the next step, so no gap is left.
- **slot**: one work's turn on a wallet queue, the only way to take a nonce and store a signed
  transaction. It closes when the work ends.
- **executor**: the execute step for live intents: it takes each confirmed live intent onto its
  wallet's queue. A paper intent never reaches it.
- **reconciliation**: the last step of a live intent: what its final transactions moved becomes the
  trade, compared with the simulation, recorded in the positions and the ledger.
- **recovery**: what the engine does at startup with every live intent a stop left unsettled: each
  stored transaction is looked up by hash and nonce, and nothing is signed again.
- **ledger**: the append-only, hash-chained record of every intent, tap, signature and fill.
- **execution**: one trade as it settled on chain or filled on paper: what the wallet sold and
  bought, the fee and the gas, each valued in USD at the time. Positions are built from executions
  and arrivals, the CSV export from executions.
- **arrival**: funds that reach a wallet without a trade, such as a deposit or the paper starting
  balance, valued in USD when they arrive. It opens a position at that value.
- **position**: what one wallet holds of one asset at average cost: the quantity, its cost with
  fees and gas, and the realized profit or loss. Paper and live keep separate positions.
- **venue**: a protocol the agent trades, lends or stakes on, such as PancakeSwap or Venus.
- **venue host**: the engine part that runs venue code. It sets each trade's terms, and checks
  every transaction a venue builds against them before anything is signed.
- **transaction draft**: a transaction a venue built, before the wallet queue gives it its nonce
  and fees.
- **transaction simulator**: the port a chain family fills to run transaction drafts unsent on the
  chain's latest state and report what each one moved, allowed and used in gas.
- **transaction preparer**: the port a chain family fills to give a transaction draft its nonce,
  gas and fees, read from the chain now, as the unsigned transaction the signer signs.
- **private relay**: an endpoint that takes a signed transaction to block builders without the
  public mempool, such as 48 Club's. A chain's relays are data in `@binference/chains`.
- **relay sender**: the port a chain family fills to send one signed transaction to every private
  relay of its chain at once and report each relay's answer.
- **relay answer**: what one relay said to one send: accepted, refused with its reason, timed out
  or unreachable. Each answer is stored per relay.
- **receipt reader**: the port a chain family fills to read a sent transaction's receipt and the
  chain's head: its latest block and its final block by the chain's finality rule. It also reads
  what a mined transaction moved, how many transactions of an account the blocks up to one block
  hold, and the native coin an account received in a block without a log.
- **tracing RPC**: an RPC node of the owner's that answers `debug_traceTransaction`, named per
  chain in config. Reconciliation asks it what a trade received only once the other RPCs dropped
  the block's state.
- **simulation check**: the simulate step of the money path. The wallet's net balance changes in
  the simulation must match the intent: exactly the input leaves, at least the minimum out arrives,
  no other asset leaves or arrives, and no allowance is set but the plan's own approval.
- **registry**: the verified contract addresses in `@binference/chains`.
- **launch contract**: a contract a launchpad makes with each launch, such as a token's own curve.
  No registry lists one: the launchpad's curve read names it for a token it holds, and only that
  token's trades and price reads call it.
- **launch wallet**: a small wallet of its own, funded by the owner, whose ceiling may allow a
  launch's contracts. Live trades on a launch's own curve need one; the agent wallets' ceilings
  list only registry contracts, so until it exists only a paper agent uses such a venue.
- **launcher**: the part of a launchpad's plugin that launches tokens: it quotes a launch from the
  launchpad's contracts, uploads its words and picture, reports their pin, and builds and decodes
  the create call. A launchpad with no API for pictures uploads nothing: it takes a picture link,
  or writes a small picture into its create call. It never signs.
- **launch draft**: a token launch the agent suggests with `launch/draft`, held 10 minutes; the
  owner starts it with Start launch in Telegram, and its card follows. The agent never starts a
  launch itself.
- **picture link**: an `ipfs://` or `https://` address of a token's picture that the owner hosts,
  which a launchpad's create call names. Nothing in binference opens it.
- **pin**: a launchpad's report that it keeps a launch's picture and words on its storage. A token
  launch waits in `quoted` for it, at most 5 minutes, before its card opens.
- **launch setting**: a setting a launchpad declares for its launches, such as a tax on every
  trade, with its type, bounds and default. Its card line is the message `launch.option.<name>`.
- **launch fee**: what a launchpad charges for a launch, in the chain's coin, paid with the create
  call.
- **creator fee recipient**: the account a launch names to receive the creator's part of every
  trade's fee on the token, such as on Genius.fun, where it claims them from the launchpad.
- **holder rewards**: a Brew launch setting: the creator's part of the pool fees goes to a holder
  distributor that spends it on the token and burns what it gets, in place of a creator fee
  recipient.
- **starting market cap**: what a launched token's whole supply is worth at its pool's first
  price, in the pair it launches against, such as a Brew launch's.
- **extra launch wallet**: a live launch wallet beyond the agent's launch wallet, which only a
  rebuild adopts. Nothing trades from it; `wallet list` and `binference check` name it so the
  owner rescues what it holds.
- **hook allowlist**: per chain, the pool hooks a route may pass through, each with the fee it
  keeps and who made its pools. A route through a PancakeSwap Infinity or Uniswap v4 pool with any other hook is dropped,
  aggregator routes too.

### Chat and the agent

- **turn**: one run of the model loop, from the owner's message to the agent's answer.
- **committed turn**: a turn in which a propose tool ran. No retry and no model fallback follow.
- **outside-content mark**: the mark on a turn that read the web, X, a Telegram group or token data.
  Its cards carry a warning.
- **queues**: the wallet queue and the chat queue, one per session. A message that arrives during a
  turn is merged at the next tool boundary (**merge**, the default) or waits for the turn to end
  (**after**).
- **session**: one conversation between the owner and an agent, with an id `ses_…`. An agent has
  one open session, shared by every surface.
- **agent inbox**: the engine's store of messages for the agent runtime (`msg_…`), kept until the
  runtime takes each into its chat queue.
- **merge point**: a place in a turn where a waiting message joins it: before a later call of an
  ordered batch, after a batch, or when the model would end the turn.
- **held-back proposal**: a propose call after the first in one model response; it is not run, and
  the agent proposes it in a later turn.
- **stable prefix, volatile tail**: the parts of a model call's context that stay the same from
  call to call (instructions, workspace files, skills index, tools), and the live facts after the
  history.
- **live facts**: what an agent stands on now: its mode, freeze, approval mode, send level,
  balances, open orders and today's spend against its caps (`facts/get`).
- **compaction**: replacing the oldest part of a session's history, in what the model sees, by a
  summary that keeps every id, hash and address.
- **loop guard**: the check that ends a turn when one tool returns the same result for the same
  arguments three times.
- **routed operation**: a protocol operation the engine passes to the agent runtime to answer.
- **workspace files**: each agent's `RULES.md`, `PERSONA.md`, `OWNER.md`, `STRATEGY.md`, `NOTES.md`
  and `FIRST-CHAT.md`.
- **notes**: the agent's long-term memory, each item labelled by its origin.
- **skills**: `SKILL.md` playbooks in the Agent Skills format, read when a task matches.
- **bundled skills**: the skills in the repo's `skills/` folder. `binference-tools` is the one that
  teaches Claude Code, Codex and other MCP clients the engine's MCP tools.
- **skill lint**: `lintSkill`, which names each sentence of a skill that tells the agent to ask for
  a seed phrase, a private key, an API key, a token, a password or a passphrase, pipes a download
  into a shell, sends a secret store over the network, or writes a secret out; the install refuses
  such a skill.
- **question**: the agent's question to the owner with two to four answer buttons (`ask_owner`).
  The answer comes back as the owner's next message. A chat surface reads the open one with
  `chat/openQuestion`.
- **status line**: the one line a turn ends with when the owner should know why: a proposal waits,
  chat is paused, the turn was stopped, or it failed.
- **read, propose and control tools**: tools that read data, tools that create an intent or an auto
  order and its card, and tools that change something without moving money or opening a card
  (cancel an order, set an alert or a schedule, write a note, ask the owner).
- **image input**: `models.imageInput`, the models declared to take images as input; a model reads
  images only when it is listed there or is the vision model.
- **vision model**: `models.vision`, which reads images when the main model cannot.
- **model budget**: the daily dollar budget for an agent's model calls.

### Setup and operations

- **self-hosted**: the profile where the owner runs binference on their own machine with their own
  keys.
- **bInference Cloud**: the hosted profile on binference.io, on the same packages.
- **profile**: self-hosted or Cloud. Only the composition root knows which.
- **profile parts**: the parts whose adapter depends on the profile: custody (the `Signer` port),
  the bot's updates, model billing, secrets, the store and market data. Each is a port.
- **update source**: where the engine reads a bot's inbound updates, by long polling or through a
  webhook relay. The engine stores each update in the inbox before it acknowledges it.
- **notice**: one owner notification of spec 4, section 4, such as a freeze or low gas. The engine
  stores each for 90 days, pushes it as `notice/new` and sends it to the owner's chat through the
  outbox.
- **daily summary**: the notice `notice.daily` that tells the owner each agent's last 24 hours once
  a day, at 09:00 owner time unless the agent names another time: live and paper value, realized
  P&L, fills and skips, open orders, model spend and what waits for the owner. An agent with
  no live funds and nothing else to tell gets none.
- **outbox**: the store's queue of what the engine sends to a chat surface. A delivery is `queued`,
  `sent`, `unknown_after_send` or `failed`; one whose outcome is unknown is never sent again.
- **model billing**: what pays for an agent's model calls and says what the agent may still spend:
  the model budget, or bInference AI credit.
- **market data**: the blocks and prices the watchers stream.
- **market reads**: a token's pools, a chain's trending tokens and a token's chart, read from the
  data sources for the owner and the agent. They inform; they never price a trade.
- **chart**: a token's OHLCV candles in USD, one per interval, from its deepest pool.
- **price scale**: how many whole tokens a market read's prices are for, as a power of ten, so a
  token below a cent keeps its digits (`priceScale`).
- **data source**: a `data` plugin that answers market reads, such as `dexscreener`. Defined with
  `defineData`.
- **boost**: paid promotion of a token on DEX Screener. A trending token carries its active boosts,
  so a reader knows its place was bought.
- **plugin**: an installable integration of one kind: venue, data, surface, skills or provider.
- **surface plugin**: a plugin that adds a chat surface.
- **plugin tiers**: **Core** (bundled and reviewed), **Verified** (a reviewed, signed publisher) and
  **Community** (anyone; read-only, in a sandbox).
- **permission review**: the consent step when a plugin is added or an update widens what it
  declares.
- **secret sources**: how config names a secret without its value: `{ fromKeychain }`,
  `{ fromEnv }`, `{ fromFile }` and `{ fromCommand }`.
- **config migration**: what `binference check --fix` runs to move older config or data to the
  current shape.
- **engine lock**: the file lock that allows one engine per state folder.
- **store worker**: a worker thread that holds one connection to `engine.sqlite` or
  `agent.sqlite`: the database's one **writer**, or one of its **readers**.
- **store task**: a named, synchronous unit of database work that a store worker runs; a write task
  runs in one transaction.
- **store ports**: the engine's ports for the state it keeps: intents with their cards and
  confirmations, the ledger, the inbox, idempotency keys, access, agents, the install with its
  wallets, and the config journal. `store` holds their SQLite adapters; each port has one contract
  suite and an in-memory fake.
- **stored intents**: the engine's one writer of intents. It stores each new intent and every move
  the state machine decides through the intent store, pushes each write as it lands, and is the
  confirmation store the confirmations answer through.
- **start code**: the single-use code in the `t.me/<bot>?start=<code>` link `binference init`
  prints; only its SHA-256 is stored. The first person who opens the link becomes the **owner
  binding**: the owner's numeric Telegram id, the only Telegram user binference obeys.
  `binference telegram pair` prints a new one, valid 10 minutes, whose first opener replaces the
  owner, who is told in their chat.
- **update intake**: where Telegram updates come in. Long polling and a webhook relay both feed
  it, and Telegram learns an update arrived only after the intake has stored it, cut to its ids
  when a text in it looks like a secret.
- **poll worker**: the worker thread that calls `getUpdates` for the engine; a **poller lease**
  keeps one poller per bot token in a process.
- **throttler**: one per bot token; it paces the bot's Bot API calls by Telegram's limits and owns
  every wait Telegram asks for with a 429.
- **state folder**: `~/.binference`, moved by `BINFERENCE_HOME`.
- **unlock mode**: where the agent key and the Privy app secret are read at start: `keychain`,
  `file`, `command` or `manual`.
- **check-back**: the last 6 characters of the owner key's code, which the owner types back at
  `binference init` before anything is made.
- **attach**: `binference init --attach`, which makes a new agent key on this machine the one
  signer of every live wallet of the install, with the owner key; the key it replaces signs
  nothing more, and that machine stays locked with `signer_revoked`.
- **revoke (a signer)**: `binference signer revoke`, which removes a machine's agent key from every
  live wallet with the owner key, never this machine's own key or a wallet's last signer.
- **signer ID**: Privy's id of the key quorum that holds a machine's agent key; attach prints it.
- **answers file**: the JSON5 file `binference init --answers` reads, one key per flag in camel
  case, secrets only as secret sources; a flag, then a `BINFERENCE_INIT_*` variable, wins over it.
- **start over**: `binference init --start-over`, which sets up a folder set up before with a new
  owner key and a new wallet, keeps the stored agent key, and archives the earlier wallets.
- **passphrase store**: secrets in owner-only files in `~/.binference/keys/`, each sealed with the
  owner's passphrase; the fallback where no OS keychain answers, such as headless Linux and Docker.
- **background service**: the engine started at the owner's login and restarted after a crash: a
  LaunchAgent on macOS, a `systemctl --user` unit on Linux, a scheduled task on Windows.
- **scopes**: what a protocol client may do: `read`, `propose`, `chat`, `agent`, `confirm`, `loosen`
  and `admin`.
- **operation**: a protocol call named `domain/action`, such as `intent/propose`.
- **frames**: the protocol's messages: `open`, `challenge`, `prove`, `ready`, `call`, `reply`,
  `fail`, `push` and `bye`.
- **push topic**: a stream of pushes, such as `intent` or `chat:<agent id>`, numbered by its own
  `seq`. A client that sees a gap in `seq` refetches the topic's state once.
- **operation table**: every operation with its args and result schemas and whether it writes; the
  typed client is built over it.
- **operation handlers**: the functions, one per operation, that the engine and the agent runtime
  give the protocol server. The server checks each call's scopes, transport and idempotency key, then
  routes it to its handler.
- **Binance Agent**: an agent the owner runs on Binance Agent OS and connects to binference.
- **decision record**: a file in `docs/adr/` that records one decision (ADR).
- **fork suite**: the tests in each package's `src/fork/`, run by `pnpm test:fork` and nightly in
  CI against an anvil fork of BSC at a block pinned 20 behind the head. Its **test account** is
  anvil's first default account with its EIP-7702 code cleared; its **logs node** is a loopback
  endpoint that reads history from a public node serving `eth_getLogs`.
- **replay suite**: the `*.replay.test.ts` files in each package's `src/fork/`, run by
  `pnpm test:replay` and nightly in CI. A **replay** moves today's pools on the fork along a
  **recorded day**, a committed price path of three PancakeSwap v2 pairs block by block, one block a
  block time, and measures each fill's **trigger-to-fill** blocks: from the block whose price fired
  it to the first block mined after it was sent.
- **model evaluation**: `pnpm eval:models`, which runs the **scenarios** on candidate models and
  scores each against the bar, three runs a scenario: every **safety** scenario passes in all its
  runs, and the **understanding** scenarios in at least 90% of theirs, in each language. A **scenario** is one case in one language: what
  the owner says, what the engine, the web and images answer, and what the **scorer** checks. A
  **stand-in model** answers a scenario with its scripted right or wrong answer, to prove the
  scorer without a network.
- **crash suite**: the tests in each package's `src/crash/`, run by `pnpm test:crash` and nightly
  in CI on Linux, macOS and Windows. Each run kills an engine process at a **kill point** of the
  money path (after signing, after storing, after a relay passed the bytes on, after the send was
  recorded, after a block took it) and starts it again, against anvil on a chain of its own.

### Files, commands and tools

- **files**: `config.json5` (the config), `engine.sqlite` and `agent.sqlite` (the databases),
  `NOTICES.md` (third-party notices).
- **commands**: `binference init`, `start`, `status`, `health`, `logs`, `approval`, `confirm`,
  `deny`, `wallet list`, `wallet address`, `wallet create`, `wallet create --launch`, `wallet export`, `ceiling`, `ceiling set`, `check`, `check --fix`, `check security`, `report`,
  `console`, `chat`, `mcp`, `live`, `paper`, `freeze`, `unfreeze`, `rescue`, `rescue set`, `rescue cancel`,
  `safety status`, `address list`, `address add`, `address remove`, `limit`, `limit set`,
  `limit cancel`, `telegram pair`, `unlock`, `expose`, `uninstall`, `uninstall --state`, `reset`.
- **chat commands**: `/spend` (model spend), `/ai` (models), `/clear` (new session), `/freeze`,
  `/rescue`, `/console`, and `/confirm` as the text fallback for a button.
- **agent tools**: `ask_owner`, `open_skill`, `search_web`, `read_page`, `search_x`, `notes_search`,
  `notes_write`, `workspace_write` (the owner's strategy and persona), `first_chat_end`,
  `alert_create`, `schedule_list`, `schedule_create`, `schedule_cancel`.
- **MCP tools**: the MCP server's read and propose tools, one per operation and named
  `binference_`, such as `binference_propose` for `intent/propose`.
- **request id**: the optional `requestId` an MCP client gives a propose tool, sent as the call's
  idempotency key: a retry with the same id returns the first intent and its card, not a new one.
- **coding-agent skills**: `clean-diff`, `review-diff`, `shape-commit`, `review-money-path`,
  `add-migration`, `write-adr`.

## Chinese terms

Every Chinese message uses these terms. A term missing here is added first, in the change that needs
it. Write Chinese the way Binance's own Chinese docs do:

- Address the reader as 你, never 您.
- Put a half-width space between Chinese and Latin letters, digits, `$` and `{arguments}`:
  `连接 BNB Chain`, `7 天`.
- Use full-width punctuation inside Chinese sentences (`，。：；！？（）“”`) and no dashes of any
  kind.
- Write numbers and money exactly as in English: `$1.20`, `0.005 BNB`, `1.2M`.
- Keep product, chain, protocol and token names in English: binference, bInference, Binance, Binance
  Agent OS, BNB Chain, BSC, PancakeSwap, Flap, MCP, BNB, USDT. Code, field names, error codes and
  commands stay as they are.

### The agent and chat

| English                                 | 中文                    | Notes                       |
| --------------------------------------- | ----------------------- | --------------------------- |
| agent, AI agent                         | Agent, AI Agent         | "your agent" = 你的 Agent   |
| agent key                               | Agent 密钥              |                             |
| Binance agent (one on Binance Agent OS) | Binance Agent           |                             |
| engine                                  | 引擎                    |                             |
| sleep (of the machine)                  | 休眠                    |                             |
| console                                 | 控制台                  |                             |
| CLI                                     | 命令行                  |                             |
| Mini App                                | Mini App                | Stays English               |
| skill (Agent Skills)                    | 技能                    |                             |
| plugin                                  | 插件                    |                             |
| model                                   | 模型                    |                             |
| model budget                            | 模型预算                |                             |
| fallback model                          | 备用模型                |                             |
| prompt                                  | 提示词                  |                             |
| answer, response                        | 回答                    |                             |
| answer (to a card)                      | 回复                    |                             |
| request                                 | 请求                    |                             |
| streaming                               | 流式输出                |                             |
| context, context window                 | 上下文, 上下文窗口      |                             |
| summarize, summary                      | 总结, 摘要              |                             |
| input, output (tokens)                  | 输入, 输出              |                             |
| token (of a model)                      | Token                   | Never 代币 for model tokens |
| reasoning                               | 推理                    |                             |
| provider (of a model)                   | 服务商                  |                             |
| usage                                   | 用量                    |                             |
| session, turn                           | 会话, 轮                |                             |
| chat (with your agent)                  | 对话                    |                             |
| notes                                   | 笔记                    |                             |
| schedule (a timed turn)                 | 定时任务                |                             |
| schedule (of a DCA order)               | 计划                    |                             |
| scheduled turn, wake                    | 定时轮, 唤醒            |                             |
| tool calling, function calling          | 工具调用, 函数调用      |                             |
| web search, web fetch                   | 联网搜索, 网页抓取      |                             |
| research                                | 调研                    |                             |
| market intelligence                     | 市场情报                |                             |
| outside content                         | 外部内容                |                             |
| gateway                                 | 网关                    |                             |
| MCP server                              | MCP 服务器              |                             |
| picture, photo (one the owner sends)    | 图片                    |                             |
| send (a message, a picture)             | 发送                    | Money sent is 转账          |
| notification                            | 通知                    |                             |
| daily summary                           | 每日摘要                |                             |
| browser notification, browser push      | 浏览器通知              |                             |
| console device                          | 控制台设备              |                             |
| pairing code, confirmation code         | 验证码, 确认码          |                             |
| bot token (Telegram)                    | 机器人 Token            | BotFather gives it          |
| facts, not advice                       | 只陈述事实，不构成建议  |                             |
| docs                                    | 文档                    |                             |
| Binance Square                          | 币安广场                | Binance's own Chinese name  |
| timeline                                | 时间线                  |                             |
| track record                            | 业绩记录                |                             |
| checked on chain (a trade)              | 已核验                  |                             |
| brakes (pause, resume, stop)            | 刹车 (暂停, 恢复, 停止) |                             |
| approve (an agent, an order, a rule)    | 批准                    | Token approvals are 授权    |
| question (the agent asks the owner)     | 问题                    | "asks" = 想问你             |
| question (asked before an action)       | 询问                    |                             |
| closed (a question)                     | 已关闭                  | A question no longer open   |
| status line                             | 状态行                  |                             |
| first chat                              | 初次对话                |                             |
| disclaimer, privacy statement           | 免责声明, 隐私声明      |                             |

### Running binference

| English                                     | 中文                   | Notes                        |
| ------------------------------------------- | ---------------------- | ---------------------------- |
| state folder                                | 状态文件夹             | `~/.binference`              |
| usage (of a command)                        | 用法                   | Help's heading               |
| config key                                  | 配置项                 |                              |
| value (of a config key)                     | 值                     |                              |
| secret source                               | 密钥来源               |                              |
| answers file (of `binference init`)         | 应答文件               |                              |
| keychain                                    | 钥匙串                 |                              |
| unlock mode                                 | 解锁方式               | `engine.unlock.mode`         |
| passphrase                                  | 密码短语               | Seals the agent key          |
| Privy app                                   | Privy 应用             |                              |
| app ID (of a Privy app)                     | 应用 ID                |                              |
| app secret (of a Privy app)                 | 应用密钥               |                              |
| custody (who holds the agent wallets)       | 托管                   |                              |
| signer (the process)                        | 签名进程               | Holds the agent key          |
| agent runtime (the process)                 | Agent 运行时           | Runs the model loop          |
| signer (of a wallet)                        | 签名方                 | The agent key's key quorum   |
| wallet facts                                | 钱包信息               |                              |
| health signal                               | 健康信号               | Shown by `binference status` |
| log (the engine's log file)                 | 日志                   |                              |
| support bundle                              | 诊断包                 | `binference report`          |
| uninstall                                   | 卸载                   | `binference uninstall`       |
| reset (the local state)                     | 重置                   | `binference reset`           |
| background service                          | 后台服务               | `binference start`           |
| telemetry, usage counts                     | 使用统计, 使用次数统计 | `telemetry.enabled`, opt-in  |
| API address, base URL (of a model provider) | 接口地址               | Where its API answers        |
| compatible (provider of an API)             | 兼容                   | Speaks that API              |
| log in (to the computer)                    | 登录                   |                              |
| client token                                | 访问令牌               | A `bnt_` sign-in token       |
| release notes                               | 更新说明               |                              |
| roll back (an update)                       | 回退                   | Not 回滚, which is a revert  |
| key (on the keyboard), number key           | 按键, 数字键           | Terminal chat: Ctrl+Y, Esc   |

### Trading

| English                                            | 中文                         | Notes                                   |
| -------------------------------------------------- | ---------------------------- | --------------------------------------- |
| token (crypto)                                     | 代币                         |                                         |
| ticker                                             | 代币符号                     |                                         |
| buy, sell, trade                                   | 买入, 卖出, 交易             |                                         |
| swap                                               | 兑换                         |                                         |
| price, market cap, liquidity                       | 价格, 市值, 流动性           |                                         |
| slippage, price impact                             | 滑点, 价格影响               |                                         |
| slippage limit                                     | 滑点上限                     |                                         |
| route, minimum received                            | 路由, 至少收到               |                                         |
| quote (a price quote)                              | 报价                         |                                         |
| time limit (of a trade)                            | 时限                         | A trade call's deadline                 |
| tax (a token's tax)                                | 交易税                       | tax rate = 税率                         |
| network fee, gas                                   | 网络费                       | "Gas" only where the English says gas   |
| fee (a trading fee)                                | 手续费                       |                                         |
| fees (a card's line of costs)                      | 费用                         |                                         |
| launch (a token), launchpad                        | 发射, 发射台                 |                                         |
| opening buy                                        | 首笔买入                     |                                         |
| paired with (a quote token)                        | 与 X 配对交易                |                                         |
| bonding curve                                      | 联合曲线                     |                                         |
| graduate, graduation                               | 毕业                         | A token moving from its curve to a pool |
| pool (a DEX trading pool)                          | 交易池                       |                                         |
| holder rewards                                     | 持有者奖励                   |                                         |
| starting market cap                                | 起始市值                     |                                         |
| stablecoin                                         | 稳定币                       |                                         |
| holder, holders (count)                            | 持有者, 持有人数             |                                         |
| supply (of a token)                                | 供应量                       |                                         |
| honeypot (a token you cannot sell)                 | 貔貅盘                       |                                         |
| catch a new launch (buy early)                     | 抢先买入                     |                                         |
| smart money                                        | 聪明钱                       |                                         |
| front-running bot                                  | 抢跑机器人                   |                                         |
| bot                                                | 机器人                       |                                         |
| portfolio                                          | 投资组合                     |                                         |
| position, closed (sold out)                        | 持仓, 已清仓                 |                                         |
| average cost, value                                | 平均成本, 市值               |                                         |
| profit and loss (PnL), realized, unrealized        | 盈亏, 已实现盈亏, 未实现盈亏 |                                         |
| volume (traded)                                    | 交易额                       |                                         |
| win rate (tokens in profit)                        | 盈利占比                     |                                         |
| limit order, take-profit, stop-loss, trailing stop | 限价单, 止盈, 止损, 追踪止损 |                                         |
| DCA                                                | 定投                         |                                         |
| copy trade                                         | 跟单                         |                                         |
| auto order                                         | 自动订单                     |                                         |
| auto trade                                         | 自动交易                     |                                         |
| trigger price                                      | 触发价格                     |                                         |
| worst price (of an auto order)                     | 最差价格                     |                                         |
| filled, cancelled                                  | 已成交, 已取消               |                                         |
| open orders, order history                         | 挂单, 订单记录               |                                         |
| stake, unstake, claim                              | 质押, 解除质押, 领取         |                                         |
| supply, withdraw, borrow, repay (lending)          | 存入, 取出, 借款, 还款       |                                         |
| health factor                                      | 健康因子                     |                                         |
| bridge (verb)                                      | 跨链                         |                                         |
| private send                                       | 私密发送                     |                                         |
| private execution                                  | 私密执行                     |                                         |
| chain access                                       | 链上访问                     |                                         |
| block, nonce                                       | 区块, 随机数                 |                                         |
| tracing RPC                                        | 追踪 RPC                     |                                         |
| public RPC, paid RPC                               | 公共 RPC, 付费 RPC           |                                         |
| price watcher, price watching                      | 价格监控                     |                                         |
| finality, final                                    | 最终确认                     |                                         |
| transaction (on chain)                             | 交易, 链上交易               | 链上交易 where "trade" could be meant   |
| a transaction lands                                | 上链                         |                                         |
| revert (a transaction fails on chain)              | 回滚                         |                                         |
| transaction hash                                   | 交易哈希                     |                                         |
| explorer (block explorer)                          | 区块浏览器                   |                                         |
| network (chain)                                    | 网络                         |                                         |
| contract address                                   | 合约地址                     |                                         |
| alerts, alert rule                                 | 提醒, 提醒规则               |                                         |
| price alert, wallet alert, launch alert            | 价格提醒, 钱包提醒, 发射提醒 |                                         |
| exit order                                         | 平仓订单                     |                                         |
| P&L card                                           | 盈亏卡片                     |                                         |
| share (of a holding)                               | 持仓比例                     | "50% of your X" = 你持有的 X 的 50%     |
| share (use in common), shared                      | 共用                         |                                         |
| share (send to someone)                            | 分享                         |                                         |
| DEX pools                                          | DEX 交易池                   |                                         |
| venue fee                                          | 平台手续费                   |                                         |
| pool fee (what a pool hook keeps)                  | 交易池手续费                 |                                         |
| launch feed                                        | 发射动态                     |                                         |
| curve progress                                     | 曲线进度                     |                                         |
| snipe tax                                          | 狙击税                       | A launch-window tax on early buys       |
| insider wallets                                    | 内部钱包                     |                                         |
| creator (of a token)                               | 创建者                       |                                         |
| trending (tokens)                                  | 热门                         |                                         |
| market data source                                 | 行情数据源                   |                                         |
| chart, candle                                      | K 线图, K 线                 |                                         |
| price scale                                        | 价格单位                     | Prices per 10^n tokens                  |
| leader wallet (of a copy trade)                    | 带单钱包                     |                                         |
| tracked wallet                                     | 关注的钱包                   |                                         |
| venue (where the agent trades, lends or stakes)    | 平台                         | PancakeSwap, Venus                      |

### Wallets and safety

| English                                  | 中文                   | Notes                                |
| ---------------------------------------- | ---------------------- | ------------------------------------ |
| agent wallet                             | Agent 钱包             |                                      |
| launch wallet                            | 发射钱包               | Trades on a launch's own curve       |
| extra launch wallet                      | 额外的发射钱包         | Nothing trades from it               |
| pin (a launch's picture and words)       | 固定                   | The launchpad's storage keeps it     |
| picture link                             | 图片地址               | The owner hosts it                   |
| launch draft                             | 发射草稿               | The agent suggests, the owner starts |
| launch fee                               | 发射手续费             | Paid with the create call            |
| creator fee recipient                    | 创建者费用接收地址     | Claims a launch's creator fees       |
| first buy                                | 首笔买入               | The launch wallet's own buy          |
| owner key                                | 所有者密钥             | Shown once as a `bnok1` code         |
| balance                                  | 余额                   |                                      |
| withdraw, fund (a wallet)                | 提取, 充值             | Lending's withdraw is 取出           |
| top up                                   | 充值                   |                                      |
| send (to an address)                     | 转账                   |                                      |
| transfer (between your own accounts)     | 划转                   |                                      |
| recipient address                        | 收款地址               |                                      |
| private key                              | 私钥                   | API keys stay 密钥                   |
| recovery phrase                          | 助记词                 |                                      |
| API key, key                             | API 密钥, 密钥         |                                      |
| export (a private key)                   | 导出                   |                                      |
| signature, sign                          | 签名                   |                                      |
| approve (a token allowance), approval    | 授权                   |                                      |
| permit (a signed approval)               | 签名授权               |                                      |
| revoke                                   | 撤销                   |                                      |
| attach (a machine)                       | 接入                   | `binference init --attach`           |
| key quorum                               | 密钥组                 | Privy's record of signing keys       |
| connect wallet                           | 连接钱包               |                                      |
| sign in, sign out                        | 登录, 退出登录         |                                      |
| paper mode, live                         | 模拟模式, 实盘         |                                      |
| approval mode, manual, auto              | 批准模式, 手动, 自动   |                                      |
| ceiling (the wallet policy's hard limit) | 上限                   |                                      |
| per-trade cap, 24-hour cap               | 单笔上限, 24 小时上限  |                                      |
| floor price (of a 24-hour cap)           | 底价                   |                                      |
| per-trade limit, daily limit             | 单笔上限, 每日上限     |                                      |
| trade limits                             | 交易限额               |                                      |
| spending limit                           | 消费上限               |                                      |
| gas reserve                              | 网络费预留             |                                      |
| spendable (balance)                      | 可用                   |                                      |
| network fee cap                          | 网络费上限             |                                      |
| freeze, unfreeze                         | 冻结, 解除冻结         |                                      |
| rescue, rescue address                   | 紧急转出, 紧急转出地址 |                                      |
| send level                               | 转账级别               |                                      |
| address book                             | 地址簿                 |                                      |
| safety check                             | 安全检查               |                                      |
| verified (a token)                       | 已验证                 |                                      |
| take back access, give access back       | 收回权限, 恢复权限     | The agent's access to its wallet     |
| expire, expires, expiry                  | 过期, 到期             |                                      |
| backup                                   | 备份                   |                                      |
| locked                                   | 锁定                   |                                      |
| plaintext secret                         | 明文密钥               |                                      |
