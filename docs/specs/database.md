# Spec 3: the databases

Status: accepted on 2026-10-06 ([decision 0095](../DECISIONS.md#d0095)), amended by decisions
[0127](../DECISIONS.md#d0127), [0133](../DECISIONS.md#d0133), [0185](../DECISIONS.md#d0185),
[0186](../DECISIONS.md#d0186), [0189](../DECISIONS.md#d0189), [0220](../DECISIONS.md#d0220), [0244](../DECISIONS.md#d0244), [0245](../DECISIONS.md#d0245), [0249](../DECISIONS.md#d0249), [0250](../DECISIONS.md#d0250), [0251](../DECISIONS.md#d0251), [0255](../DECISIONS.md#d0255), [0265](../DECISIONS.md#d0265), [0296](../DECISIONS.md#d0296), [0297](../DECISIONS.md#d0297), [0298](../DECISIONS.md#d0298) and [0299](../DECISIONS.md#d0299); the agent runtime's additions
follow [spec 8](runtime.md) (accepted 2026-10-11). Accepted by the owner on 2026-10-12: `launches`,
`tracked_wallets` and its cap, `wallet_activity` and `watch_cursors` (section 2.6); `questions`
and `question_messages` (section 2.7); `orders.end_reason` and `alerts.wake`, `fires` and
`expires_at` (section 2.4); the versions of `safety.disclaimer_version` (section 2.1); and their
retention (section 4).

Accepted by the owner on 2026-10-30: saved addresses with their chain and recipient
bytes, and the identity's registration file (section 2.2); staking positions, unbondings and
bridges in transit (section 2.3); a webhook rule's last alert (section 2.4); a plugin's accepted
permissions (section 2.8); and their retention (section 4). Binance agents and their timeline get
their tables from spec 7, which waits on the owner's Binance account; this spec adds none for
them until then.

Approved by the owner on 2026-11-05: the Postgres form of both databases, with the agent leases
and the database roles of bInference Cloud (section 6), on decisions
[0365](../DECISIONS.md#d0365) to [0367](../DECISIONS.md#d0367).

<a id="section-1"></a>

## 1. Files and settings

| File                          | Owner process | Holds                                                            |
| ----------------------------- | ------------- | ---------------------------------------------------------------- |
| `~/.binference/engine.sqlite` | engine        | Everything about money, safety, settings that change, and access |
| `~/.binference/agent.sqlite`  | agent runtime | Chat sessions, transcripts, notes                                |

Both open with the busy timeout (5,000 ms) set in the `DatabaseSync` constructor, then
`journal_mode=WAL` and `foreign_keys=ON` (with the busy timeout set after the WAL pragma instead, 1
open in 3 failed with "database is locked"). The engine database uses `synchronous=FULL` (money);
the agent database uses `synchronous=NORMAL`. Each database has one writer behind a queue, because
SQLite hands the write lock over unfairly; reads run on worker threads.

The Cloud's Postgres adapter keeps these tables and their contract suites, and adds `agent_leases`
(agent, worker, fence, expiry) for the Cloud workers
([ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)).

Conventions ([ENGINEERING.md section 24.2](../ENGINEERING.md#section-24-2)):

- Tables and columns in `snake_case`; ids are prefixed UUIDv7 text (protocol spec 1.1).
- Times are `INTEGER` epoch milliseconds (UTC), in columns ending `_at`.
- Amounts are `TEXT` decimal strings of base units; USD is `TEXT` micro-dollars (`_usd_micros`).
- Basis points are `INTEGER` (`_bps`). Booleans are `INTEGER` 0 or 1.
- `JSON` columns hold `TEXT` that a zod schema parses on every read
  ([ENGINEERING.md section 9](../ENGINEERING.md#section-9)).
- Rows that change carry `version INTEGER NOT NULL DEFAULT 0`; every update sets
  `version = version + 1 WHERE version = ?` and fails on a stale read.
- Queries use Kysely through the synchronous dialect; raw SQL only in migrations.
- Migrations: `NNNN_name.ts`, forward-only, one transaction each, after a backup. `meta` stores
  `schema_version`; an older binference refuses a newer database
  ([decision 0062](../DECISIONS.md#d0062)).

<a id="section-2"></a>

## 2. Engine database

<a id="section-2-1"></a>

### 2.1 Install and safety

| Table           | Columns                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `meta`          | `key TEXT PK`, `value TEXT`. Keys: `schema_version`, `install_id`, `created_at`                                                                                                                                                                                                                                                                        |
| `safety`        | one row, `id = 1`: `frozen_at`, `rescue_address`, `pending_rescue_address`, `pending_rescue_at`, `disclaimer_version`, `disclaimer_accepted_at`, `version`, `rescue_ceiling` (the ceiling changes the owner key signed ahead for a waiting rescue address, as JSON, [decision 0110](../DECISIONS.md#d0110)), `rescue_reach`                            |
| `custody`       | one row, `id = 1` (spec 5): `provider` (`privy`), `app_id`, `owner_quorum_id`, `owner_key_public`, `agent_quorum_id`, `agent_key_public`, `attached_at`, `version`, `seal_key_public` (the sealing key's public half, NULL until the owner key derived it; [decision 0164](../DECISIONS.md#d0164)). No secret is stored here.                          |
| `engine_alive`  | one row, `id = 1`: `alive_at`, when the engine last ran, marked by migration 0046, then each minute while it serves and as it stops; the next start reads it to tell how long the engine was off ([decision 0266](../DECISIONS.md#d0266))                                                                                                              |
| `credentials`   | one row per credential the owner stored for the agents: its `name`, `value`, `allowed_hosts` (a JSON array of exact host names) and `updated_at`, and `deleted_at` once removed; a removed row leaves every read and is purged after 30 days. No read gives the value back but the one that sends it ([decision 0388](../DECISIONS.md#d0388))          |
| `shell_allowed` | one row per command the owner allowed always ([decision 0409](../DECISIONS.md#d0409)): `id` (`sac_`), `seq` (its write-order key from `counters`), `text` (the step as written), `program` (its real path), `args` (a JSON array of strings, word for word) and `folder` (the real path it starts in), unique together, and `allowed_at`; install-wide |
| `shell_watches` | one row per command the agent left running whose end it is still to hear: `job` (`shj_`), `agent_id`, `command`, `folder`, `started_at` and `surface` (of the turn that started it); dropped as the end is told, so one a restart lost is told at the next start                                                                                       |
| `counters`      | `name TEXT PK` (the table whose write-order key it counts), `last` (the last key it gave)                                                                                                                                                                                                                                                              |

`safety.rescue_reach` holds, as a JSON array, where each rescue address stands in each agent's
bridge rules on each destination chain: `joined`, `waiting`, `room`, `code`, `unread` or `kind`, as
last told the owner; NULL while there is none ([decision 0321](../DECISIONS.md#d0321)).

`counters` holds one row per write-order key that is not the table's own `INTEGER PRIMARY KEY`
([decision 0366](../DECISIONS.md#d0366)): `order_fills.seq`, `notices.seq` and `agent_inbox.seq`.
An insert trigger takes `last + 1` in the insert's own transaction and writes it to the new row, so
the keys follow the order rows were written and are never taken twice, even after a prune. A
migration that adds such a key numbers the rows written before it in the order the store read them.

`safety.disclaimer_version` holds the version of the disclaimer and privacy statement the owner
accepted (spec 4, section 9), as decimal text, and `disclaimer_accepted_at` when: `1` for the text
of `binference live` before 2026-10-12, `2` for the text with the wider privacy statement. An
install whose stored version is below the current one asks again before an agent goes live. A
stored version never goes down ([decision 0220](../DECISIONS.md#d0220)).

<a id="section-2-2"></a>

### 2.2 Agents, wallets and settings

| Table            | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Keys and indexes                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `agents`         | `id`, `name`, `mode` (`paper`, `live`), `frozen_at`, `archived_at`, `locale`, `models JSON`, `notifications JSON` (`{ muted, dailySummaryTime }`, [decision 0185](../DECISIONS.md#d0185)), `chat_session_id` (the open chat session, NULL until the first message; [spec 8, section 3.1](runtime.md#section-3-1)), `created_at`, `changed_at`, `version`                                                                                                                                                                                                                                                                                                   | PK `id`; unique `name`                                         |
| `limits`         | `agent_id`, `per_trade_usd_micros`, `rolling_day_usd_micros`, `slippage_registry_bps`, `slippage_other_bps`, `price_impact_bps`, `tax_bps`, `liquidity_floor_usd_micros`, `gas_reserve JSON` (per chain, base units), `venues JSON`, `allow_tokens JSON`, `deny_tokens JSON`, `model_budget_usd_micros`, `card_trade_expiry_s`, `card_other_expiry_s`, `requote_after_s`, `requote_tolerance_bps`, `order_expiry_days`, `copy_per_buy_usd_micros`, `copy_per_leader_day_usd_micros`, `changed_at`, `version`, `pending JSON` (the looser limits that wait, in the encoding of the columns before it, [decision 0111](../DECISIONS.md#d0111)), `pending_at` | PK `agent_id` → `agents`                                       |
| `approval_modes` | `agent_id`, `mode` (`manual`, `auto`), `changed_by_surface`, `changed_at`, `version` ([decision 0088](../DECISIONS.md#d0088))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PK `agent_id`                                                  |
| `send_levels`    | `agent_id`, `level`, `pending_level`, `pending_at`, `changed_at`, `version`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | PK `agent_id`                                                  |
| `address_book`   | `id`, `agent_id`, `chain` (the wallet's chain, or a destination chain the registry lists), `address` (as its chain family writes it: checksummed hex, or base58 on Solana), `recipient_bytes` (the 20 or 32 bytes, lowercase hex, that every ceiling of the agent binds with the chain's id; [decisions 0297](../DECISIONS.md#d0297) and [0298](../DECISIONS.md#d0298)), `label`, `usable_at`, `in_ceiling_at` (when the owner key saved it in the Privy policy, [decision 0091](../DECISIONS.md#d0091)), `created_at`, `removed_at`                                                                                                                       | unique `(agent_id, chain, address)` where `removed_at IS NULL` |
| `wallets`        | `id`, `agent_id`, `family` (`evm`), `custody` (`privy`), `custody_wallet_id`, `policy_id`, `signer_id`, `address`, `label`, `created_at`, `archived_at`, `role` (`agent`, `launch`: decisions 0217 and 0218, `bridge`: decision 0303; an agent may hold more than one live wallet of a role after a rebuild, the first the one it uses)                                                                                                                                                                                                                                                                                                                    | unique `custody_wallet_id`; unique `address`                   |
| `ceilings`       | `wallet_id`, `policy_id`, `policy JSON` (a mirror of the wallet's Privy policy, read back after every change), `per_tx_native` (base units), `read_at`, `version`; the policy step refuses with `ceiling` before Privy would (spec 6)                                                                                                                                                                                                                                                                                                                                                                                                                      | PK `wallet_id`                                                 |
| `nonces`         | `account` (CAIP-10), `next_nonce`, `changed_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PK `account`                                                   |
| `identities`     | `agent_id`, `chain`, `registry`, `onchain_id`, `tx_hash`, `registered_at`, `file` (the registration file as the transaction stored it, a data URI); written with its `registerIdentity` intent's move to `reconciled`, once the registry read it back ([decision 0335](../DECISIONS.md#d0335))                                                                                                                                                                                                                                                                                                                                                             | PK `agent_id`                                                  |

<a id="section-2-3"></a>

### 2.3 Intents, cards and transactions

| Table              | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Keys and indexes                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `intents`          | `id`, `agent_id`, `wallet_id`, `kind`, `state`, `reason`, `request JSON`, `plan JSON`, `quote JSON`, `risk JSON`, `simulation JSON`, `authorized_by JSON`, `outside_content`, `paper`, `proposer` (`tok_…`, `dev_…`, `telegram`, `engine`), `value_usd_micros` (what the policy judged the outflows worth, which the 24-hour cap counts from the confirmation, [decision 0136](../DECISIONS.md#d0136); null when the policy valued nothing), `assets JSON` (what each token it names and the registry does not list answered on chain at the proposal, marked unverified, which its cards show, [decision 0199](../DECISIONS.md#d0199); null when it names none), `draft_ref` (the reference of the launch draft whose Start proposed it, so a press of a draft a restart forgot finds its launch, [decision 0288](../DECISIONS.md#d0288); null for any other intent), `created_at`, `changed_at`, `version` | `(agent_id, state)`; `(state, changed_at)`; unique `draft_ref` where set                                                                                                             |
| `intent_events`    | `id`, `intent_id`, `from_state`, `to_state`, `cause JSON`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `(intent_id, at)`; `(to_state, at)`                                                                                                                                                  |
| `cards`            | `id`, `intent_id`, `version`, `terms_hash`, `callback_ref` (the reference its buttons carry, 12 random bytes in base64url), `opened_at`, `expires_at`, `closed_at`, `close_reason`, `place JSON` (where the version's buy or sell trades), `auto_ask` (why auto mode opened the version, an auto test code)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | unique `(intent_id, version)`; unique `callback_ref`                                                                                                                                 |
| `card_messages`    | `card_id`, `surface` (`telegram`, `console`, `mini`), `chat_id`, `topic_id`, `message_id`, `sent_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | PK `(card_id, surface, message_id)`                                                                                                                                                  |
| `confirmations`    | `id`, `intent_id`, `card_id`, `card_version`, `terms_hash`, `by_surface`, `by_ref`, `at`, `expires_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | unique `intent_id`; a later card version's confirmation replaces the row (decision 0143)                                                                                             |
| `carried_outflows` | `intent_id`, `agent_id`, `paper`, `confirmed_at`, `value_usd_micros`, `carried_at`: an outflow the rolling 24-hour cap counted in the state a restore replaced ([decision 0162](../DECISIONS.md#d0162))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | key `intent_id`; `(agent_id, paper, confirmed_at)`                                                                                                                                   |
| `late_landings`    | `intent_id`, `tx_id` (the dropped step's transaction a block holds after all), `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | key `intent_id`                                                                                                                                                                      |
| `txs`              | `id`, `intent_id`, `step`, `chain`, `account`, `nonce`, `state`, `raw`, `hash`, `gas_price`, `relays JSON`, `supersedes`, `replacement` (`speedUp`, `cancel`, set with `supersedes`), `block_number`, `receipt JSON`, `signed_at`, `sent_at`, `included_at`, `final_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | unique `(account, nonce)` where `state IN ('signed','sent','included','final')`; `hash`; `(intent_id, step)`                                                                         |
| `tx_sends`         | `tx_id`, `attempt` (the send of the transaction), `place` (the relay's place in its list), `relay`, `outcome` (`accepted`, `refused`, `timed_out`, `unreachable`), `reason` (a refusal's: `nonce_too_low`, `underpriced`, `replacement_underpriced`, `insufficient_funds`, `gas_quota`, `malformed_transaction`, `rate_limited`, `bad_answer`, `rejected`), `code` (a refusal's code, when the relay gave one), `at`: each private relay's answer to each send of a signed transaction                                                                                                                                                                                                                                                                                                                                                                                                                       | primary key `(tx_id, attempt, place)`; unique `(tx_id, attempt, relay)`                                                                                                              |
| `executions`       | `id`, `intent_id`, `wallet_id`, `asset_in`, `amount_in`, `fee_amount` (the venue's fee, in `asset_in`), `asset_out`, `amount_out`, `gas_asset`, `gas_amount`, `tx_hash` (null on paper), `value_usd_micros` (`amount_in` then), `fee_usd_micros`, `gas_usd_micros`, `paper`, `at`, `realized_usd_micros` (what it realized at average cost when recorded, below zero for a loss; 0 for a row from before, [decision 0137](../DECISIONS.md#d0137))                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `(wallet_id, at)`                                                                                                                                                                    |
| `arrivals`         | `id`, `wallet_id`, `asset`, `amount`, `value_usd_micros` (null when no price was known), `tx_hash`, `paper`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `(wallet_id, at)`                                                                                                                                                                    |
| `departures`       | `id`, `intent_id`, `wallet_id`, `asset`, `amount`, `gas_asset`, `gas_amount`, `tx_hash`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `(wallet_id, at)`; `intent_id`                                                                                                                                                       |
| `stake_unbondings` | `id`, `intent_id` (the unstake), `wallet_id`, `venue` (`stakehub`, `lista`), `validator` (CAIP-10; a liquid venue's pool, Lista's stake manager on `lista`, [decision 0331](../DECISIONS.md#d0331)), `request_ref` (the venue's own id of the request), `asset` (the chain's coin), `amount`, `value_usd_micros` (what the unstake recorded it worth), `ready_at`, `claim_intent_id`, `claimed_at`, `told_ready_at` (when the owner was told its coin can be claimed), `paper`, `closed_outside_at` (when its venue no longer listed its request, claimed outside binference, [decision 0331](../DECISIONS.md#d0331))                                                                                                                                                                                                                                                                                        | unique `intent_id`; unique `(venue, wallet_id, paper, request_ref)`; `(wallet_id, paper, venue, ready_at)` while unclaimed; `ready_at` while unclaimed and untold; `claim_intent_id` |
| `bridges`          | `intent_id`, `venue`, `deposit_ref` (the deposit's transaction on the source chain), `to_chain`, `recipient` (CAIP-10), `sent_asset`, `sent_amount`, `delivered_asset` (CAIP-19 on `to_chain`), `delivered_coin` (the destination's coin a fill pays an account with no code in place of `delivered_asset`, such as ETH for WETH), `min_out`, `value_usd_micros` (what the sent units left their position with), `state` (`in_transit`, `late`, `delivered`, `refunded`), `status_url`, `sent_at` (the deposit's final block time), `late_at`, `fill_tx`, `received` and `received_asset` (what the read found arriving, at the recipient or back at the wallet), `refund_tx`, `settled_at`, `checked_at`, `version`                                                                                                                                                                                         | PK `intent_id` → `intents`; `(state, sent_at)`; unique `(to_chain, fill_tx)` and `refund_tx` where set                                                                               |
| `positions`        | `wallet_id`, `asset`, `paper`, `quantity`, `cost_usd_micros`, `realized_usd_micros`, `changed_at`, `version`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | PK `(wallet_id, asset, paper)`                                                                                                                                                       |

`terms_hash` is SHA-256 over the stable JSON of what the card shows (wallet, action, amounts,
minimum out, recipient, venues, deadline). The signer checks it (spec 5, section 5.2, rule 5).

Average cost ([decision 0058](../DECISIONS.md#d0058)): a buy adds its quantity and its full cost
(amount paid in USD, plus fee and gas); a sell removes quantity at the average cost and adds the
difference to `realized_usd_micros`.

Funds that arrive without a trade, such as a deposit or the paper starting balance, are an
`arrivals` row. They are priced through the price source when they arrive, rounded up, and add
their quantity and that value to the position, so a later sale realizes a real gain or loss. When
no usable price is known then, the row keeps no value and the position does not change. A later
price never values them after the fact: units sold beyond what a position holds leave at their
own proceeds, with no gain or loss.

A step the drop rule ended can still land ([decision 0147](../DECISIONS.md#d0147)). Its intent
stays `failed_onchain`; a `late_landings` row links the landing to it, which the rolling 24-hour
cap counts, and once every step of the plan is in a final block the trade is an `executions` row
with its position changes, as a reconciliation writes it.

A restore carries every outflow the rolling 24-hour cap counted in the state it replaced into
`carried_outflows` ([decision 0162](../DECISIONS.md#d0162)). The cap counts each such row as a
confirmed intent, in the place of the restored copy's own row for the same intent, so the day's
spending stays counted across the restore.

Funds a send takes out of a live wallet, such as a rescue's transfers, are a `departures` row once
the send is final ([decision 0127](../DECISIONS.md#d0127)): the units sent, and the native coin it
paid for gas. Both leave their positions at average cost, rounded down, with no gain or loss; units
beyond what a position holds take no cost. An intent's departures are written once, in one
transaction with their position changes.

**Staking** ([decision 0296](../DECISIONS.md#d0296)). A staking position is a `positions` row of
the venue's own receipt token: a validator's credit shares on StakeHub, slisBNB on Lista. A stake
is an `executions` row that spends the chain's coin for that token, at average cost like a buy. An
unstake is an `executions` row that sells the receipt token for its value in the chain's coin at
that moment, which realizes what the stake earned; the coin it took out goes into a
`stake_unbondings` row, not into the wallet's position, since the wallet does not hold it yet. The
row is written before the sale, and a sale booked again after a stop takes the row's value; with no
price the row has no value and the sale waits for one. A claim sets `claim_intent_id` and
`claimed_at` on the rows it took, then their amount arrives in the wallet's position at the value
their unstakes recorded, with no gain or loss, and the rest of what it took, such as a part an
unstake outside binference made, arrives with no value and opens no position. Each write is found
again before it is made, so a claim, a stake or an unstake booked again after a stop books nothing
twice ([decision 0327](../DECISIONS.md#d0327)). So a dollar counts once: staked, unbonding or back
in the wallet. `told_ready_at` records that the owner was told once a row's coin can be claimed
(`notice.claimReady`).

**Bridges** ([decision 0297](../DECISIONS.md#d0297)). A bridge's deposit, once final, writes its
`departures` rows, the units leaving their position at average cost, then its `bridges` row in
`in_transit`, each once ([decision 0320](../DECISIONS.md#d0320)). The engine reads each row that is
in transit or late, 100 a pass, paging through them all: 2 hours after `sent_at` it marks `late`
once; a delivery read its venue matches to the deposit by their events moves it to `delivered`
with `fill_tx` and `received`, and a refund read to `refunded` with `refund_tx`, whose returned
units are an `arrivals` row at their value then, stored once by `refund_tx` before the row moves.
One fill per destination chain, and one refund, settles one row at most. The intent moves to
`reconciled` after its row settled; a stop between them is finished by the next reconciliation,
which tells the owner what the receipt does not. Each write checks `version`. A row in transit or late counts in the agent's live
total at `value_usd_micros`.

**Saved addresses on other chains.** `recipient_bytes` is the address codec's output for the
entry's chain family, written when the entry is added and never recomputed; a bridge's recipient
check compares a deposit's recipient with it. The ceiling's rule for the entry binds the same
bytes and the chain's id together: custody takes the entry's CAIP-10 account and derives them
through the same codec ([decision 0313](../DECISIONS.md#d0313)). Two entries of one agent never hold
the same chain and address, as the unique index says, while one address may be saved on several
chains.

<a id="section-2-4"></a>

### 2.4 Orders, alerts, webhook rules and schedules

| Table            | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Keys and indexes                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `orders`         | `id`, `agent_id`, `wallet_id`, `kind`, `state` (`awaiting_confirmation`, `active`, `paused` while its agent is frozen, `filled`, `cancelled`, `expired`, `ended`), `request JSON` (with its defaults filled), `trigger_state JSON` (for example a trailing stop's highest price), `fills`, `max_fills`, `expires_at`, `intent_id` (the `autoOrder` intent that carries its card), `card_id` (the card version that confirmed it), `paper` (its agent's mode when it was created, the mode it fills in), `outside_content` (the proposing turn's mark, spec 8 section 4.3), `end_reason` (why an `ended` order ended: `position_closed`, spec 6 section 5), `expiry_noticed_at` (when `notice.orderExpiring` went), `created_at`, `changed_at`, `version` ([decision 0189](../DECISIONS.md#d0189)) | `(state, agent_id)`; `intent_id`; `(wallet_id, paper, state)`                           |
| `order_fills`    | `id`, `order_id`, `intent_id`, `outcome` (`filled`, `skipped`), `reason`, `at`, `notices` (JSON, what the owner hears of the row, written with it; [decision 0197](../DECISIONS.md#d0197)), `announced_at`, `copy_trade` and `copy_take` (a copy order's row: the leader trade it copied and the take it ran under, [decision 0260](../DECISIONS.md#d0260)), `seq` (its write-order key, from `counters`)                                                                                                                                                                                                                                                                                                                                                                                         | `(order_id, at)`, `(at)` where `notices` is set and `announced_at` is not, unique `seq` |
| `alerts`         | `id`, `agent_id`, `condition JSON`, `kind`, `account` and `asset` (the condition's kind, a wallet alert's account and a price alert's asset), `state` (`active`, `fired`, `deleted`, `ended`), `wake` (start a turn when it fires, spec 1 section 8.4), `fires` (how many times it fired), `outside_content`, `created_by`, `created_at`, `changed_at`, `fired_at` (the last fire), `expires_at`, `last_message_id` (the wake-up its last fire stored), `notice_window_at`, `notices_sent` and `notices_held` (its notice hour: five notices at most, the rest counted and told once, decision 0245)                                                                                                                                                                                              | `(state, agent_id)`; `(state, expires_at)`; `(state, account)`; `(state, asset)`        |
| `alert_fires`    | `alert_id`, `fires` (the alert's count after it), `agent_id`, `at`, `outcome` (`woke`, `replaced`, `skipped`, `quiet` for an alert without `wake`), `reason` (`frozen`, `archived`, `budget`, `hourly`, `busy`), `message_id` (the wake-up it stored or replaced), `told` (a notice told this wake-up the hourly limit held back, decision 0274); an agent's rows are kept 7 days, its newest 1,000 at most                                                                                                                                                                                                                                                                                                                                                                                       | primary key `(alert_id, fires)`; `(agent_id, at)`                                       |
| `webhook_rules`  | `id`, `agent_id`, `name`, `secret_hash`, `action JSON`, `state` (`awaiting_confirmation`, `active`, `deleted`), `rate_per_min` (1 to 60, [decision 0299](../DECISIONS.md#d0299)), `last_alert_at`, `fills`, `max_fills`, `expires_at`, `card_id`, `created_at`, `changed_at`, `version`, `wallet_id`, `intent_id` (the `webhookRule` intent that carries its card), `paper` (its agent's mode when it was made, the mode it fills in), `url_changed_at` (its creation or its last rotation), `old_url_last_event` (the last `webhook_events` row its old URL took at its last rotation, 0 before one, decision 0337), `notice_window_at`, `notices_sent` and `notices_held` (its notice hour)                                                                                                     | `(state)`; `(agent_id, state)`; unique `intent_id`                                      |
| `webhook_events` | `id`, `rule_id`, `alert_id`, `body_hash`, `received_at`, `outcome` (`accepted`, `repeat`, `rate`, `rejected`), `intent_id`, `engine_locked` (the engine was locked as it arrived, decision 0336), `fill_outcome` (`filled`, `skipped`, on an accepted alert only, a fill with its intent), `fill_reason` (a skip's alone), `notices` (JSON, with an outcome), `announced_at` (with notices)                                                                                                                                                                                                                                                                                                                                                                                                       | `(rule_id, received_at)`; `(rule_id, alert_id)`                                         |
| `schedules`      | `id`, `agent_id`, `when JSON`, `prompt` (at most 2,000 characters), `state` (`active`, `cancelled`, `ended`), `next_at` (set while `active`), `zone` (the IANA zone `next_at` was worked out in, decision 0231), `last_at`, `last_due_at`, `last_outcome`, `last_reason` (the last run, decision 0232), `last_message_id` (its last wake-up), `created_by`, `outside_content`, `created_at`, `changed_at`                                                                                                                                                                                                                                                                                                                                                                                         | `(state, next_at)`; `(agent_id, state)`                                                 |
| `schedule_runs`  | `schedule_id`, `due_at`, `at`, `outcome` (`sent`, `skipped`), `reason` (`frozen`, `archived`, `budget`, `waiting`, `busy`), `message_id` (the `inbox/scheduleDue` a sent run stored)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | primary key `(schedule_id, due_at)`; `(at)`                                             |

A webhook rule's `action JSON` holds its bounds as `webhookRule/create` took them. An agent holds
at most 20 rules that are `awaiting_confirmation` or `active`. `last_alert_at` is the last
accepted alert's time. `webhook_events.alert_id` is the body's `id`, or null when it has none,
and the rate counts a rule's `accepted` rows of the last 60 seconds. Per
[decision 0333](../DECISIONS.md#d0333): a repeat is an `accepted` row of the rule with the same
`alert_id` or `body_hash` of the last 10 minutes; the listener writes no `rejected` row; a request
that gets `404` writes no row. An accepted alert's row, its `inbox` entry (`source_key`
`wh:<webhook_events.id>`, payload `{ rule, event, alertId?, body }` with the body as `{ text }`
when it is UTF-8, else `{ base64 }`) and the rule's `last_alert_at` are one write, and
`webhook_events` is also indexed by `(rule_id, outcome, received_at)` and `(received_at)`, and its `id`
is never reused after a prune (`AUTOINCREMENT`), since the inbox entry keyed on it outlives the
row. The `inbox` is also indexed by `handled_at` where it is set, for its prune.

Per [decision 0338](../DECISIONS.md#d0338), an accepted alert's fill is keyed on its
`webhook_events` row: the row's `intent_id` names the one intent that filled or skipped it, unique,
and its `fill_outcome` is written once, a fill in the same write as its intent's move and its rule's
`fills`, a skip with its reason. The notices the owner hears of it are kept on the row until
`announced_at`, indexed while they wait.

<a id="section-2-5"></a>

### 2.5 Money records that never change

| Table    | Columns                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| `ledger` | `seq INTEGER PK AUTOINCREMENT`, `id`, `at`, `agent_id`, `kind`, `subject` (an id), `data JSON`, `prev_hash`, `hash` |

- Triggers refuse `UPDATE` and `DELETE` on `ledger`. Nothing prunes it.
- `hash = SHA-256(prev_hash || stable_json({ seq, id, at, agent_id, kind, subject, data }))`; the
  first entry's `prev_hash` is 64 zeros
  ([ENGINEERING.md section 24.3](../ENGINEERING.md#section-24-3)).
- `binference check` walks the chain; a break is a critical finding.

<a id="section-2-6"></a>

### 2.6 Market data and caches

| Table             | Columns                                                                                                                                                                                                                                                                                                        | Keys                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `prices`          | `asset`, `source` (`chainlink`, `quote`, `dexscreener`), `usd_micros`, `at`                                                                                                                                                                                                                                    | PK `(asset, source)`                                                                    |
| `risk_cache`      | `asset`, `source` (`goplus`, `honeypot`, `simulation`), `result JSON`, `fetched_at`                                                                                                                                                                                                                            | PK `(asset, source)`                                                                    |
| `launches`        | `chain`, `token`, `launchpad`, `creator`, `quote_token`, `symbol`, `name`, `decimals` (decision 0255), `tax_bps`, `snipe_tax_bps`, `curve_progress_bps`, `graduated`, `insiders JSON`, `block`, `block_hash`, `tx_hash`, `log_index`, `launched_at`, `changed_at`                                              | PK `(chain, token)`; `(chain, launched_at)`; `(creator, launched_at)`; `(chain, block)` |
| `tracked_wallets` | `account` (CAIP-10), `since_block` (the first block read), `last_block` (the last block read), `overflow_blocks` (blocks whose reads the per-block budget cut), `added_at`, `untracked_at`, `overflow_told_blocks` and `overflow_told_at` (the cut blocks the owner was last told of, and when, decision 0250) | PK `account`                                                                            |
| `wallet_activity` | `id`, `account`, `block`, `tx_hash`, `log_index`, `side` (`buy`, `sell`), `asset`, `amount`, `counter_asset`, `counter_amount`, `value_usd_micros`, `share_sold_bps`, `venue`, `at`                                                                                                                            | unique `(account, tx_hash, log_index)`; `(account, at)`                                 |
| `watch_cursors`   | `watcher` (`launches`, `wallets`), `chain`, `block`, `block_hash`, `at`                                                                                                                                                                                                                                        | PK `(watcher, chain)`                                                                   |

- **`launches`** holds one row per token a launchpad created, written by the launch watcher from
  the launchpad plugin's decoded create event, insert-or-ignore on its key, so a block read twice
  records each launch once. `curve_progress_bps` and `graduated` are updated in place as the
  watchers read them; `insiders` holds the wallets the launchpad or the risk step names as exempt
  or first holders; `symbol`, `name` and `decimals` are the token's as the feed read them, never
  verified. A read that covers a launch's block again and no longer holds it deletes it: a
  reorganization removed it. A token read again in another block moves there and stays one launch
  (decision 0255).
- **`tracked_wallets`** holds each account an active `copy` order names as its leader, or an active
  `wallet` alert names. The write that makes such an order or alert active adds the row, or clears
  its `untracked_at`; the write that ends the last of them sets `untracked_at`, and the leader
  watcher stops reading it. A wallet tracked again reads on from the block it is added at: a gap
  is never filled from history.
- **At most 50 tracked wallets per install**, the rows without `untracked_at`. The leader watcher
  reads each block with a fixed budget, whatever the number of wallets: one log query for ERC-20
  transfers to the tracked set and one for transfers from it, each with every tracked address in
  its topic filter, and the block's transactions once for native value. The cap keeps those topic
  filters short; 50 is a starting value, which the leader watcher's task checks against the
  log-capable endpoints, and only a decision record raises. The cap also counts the leaders of copy
  orders still awaiting their card, so a confirmation never passes it; a call that would pass it
  fails `wallet.track_limit` (spec 1, section 8.4).
- **`wallet_activity`** holds the trades the leader watcher read for tracked wallets: transfers of
  an ERC-20 to and from the wallet and its native value, matched into buys and sells, with the
  share of its holding a sale took. `wallet/activity` reads a tracked wallet here, and only
  a tracked one ([decision 0259](../DECISIONS.md#d0259)). A read of a block again, after a
  reorganization, drops a wallet's rows in that block that it no longer holds
  ([decision 0262](../DECISIONS.md#d0262)).
- **`watch_cursors`** holds where each log watcher stopped. After an outage it checks that the
  stored block still has `block_hash`, then reads on from the block after it; when the hash
  differs, it reads again from the chain's last final block.

<a id="section-2-7"></a>

### 2.7 Surfaces, delivery and idempotency

| Table               | Columns                                                                                                                                                                                                                                                                                                                                                                            | Keys and indexes                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `inbox`             | `id`, `source` (`telegram`, `webhook`), `source_key` (`tg:<bot>:<update>`), `payload JSON`, `received_at`, `handled_at`                                                                                                                                                                                                                                                            | unique `source_key`                                      |
| `outbox`            | `id`, `surface`, `target JSON`, `payload JSON`, `state` (`queued`, `sent`, `unknown_after_send`, `failed`), `attempts`, `next_at`, `ref`, `created_at`, `sent_at`                                                                                                                                                                                                                  | `(state, next_at)`                                       |
| `notices`           | `id`, `agent_id`, `kind` (the notice's name), `i18n_key`, `values JSON` (the message's values, times, amounts, parts and the messages that follow it), `level` (`info`, `warning`, `critical`), `at`, `delivered JSON` (each surface's delivery state), `intent_id` (the intent it is about, [decision 0133](../DECISIONS.md#d0133)), `seq` (its write-order key, from `counters`) | `(at)`, unique `seq`                                     |
| `idempotency`       | `credential`, `op`, `key`, `args_hash`, `result JSON`, `at`                                                                                                                                                                                                                                                                                                                        | PK `(credential, op, key)`                               |
| `agent_inbox`       | `id` (`msg_…`), `agent_id`, `session_id`, `kind` (the `inbox` push kind), `turn_id` (the turn reserved for it), `payload JSON`, `created_at`, `taken_at`, `seq` (its write-order key, from `counters`)                                                                                                                                                                             | `(agent_id, taken_at)`, unique `seq`                     |
| `model_usage`       | `id`, `key` (each attempt's own, `<turn>.usage.<n>`), `agent_id`, `turn_id`, `model`, `input_tokens`, `output_tokens`, `cached_tokens`, `usd_micros`, `at`                                                                                                                                                                                                                         | unique `key`; `(agent_id, at)`                           |
| `budget_notices`    | `agent_id`, `day_at` (the start of the owner's day on which the agent's model budget was spent), `at`                                                                                                                                                                                                                                                                              | PK `(agent_id, day_at)`                                  |
| `daily_summaries`   | `agent_id`, `date` (the owner's date it is for, `YYYY-MM-DD`), `at`, `outcome` (`sent`, `idle`), `live_usd_micros`, `paper_usd_micros` (the totals it read; NULL when unread)                                                                                                                                                                                                      | PK `(agent_id, date)`                                    |
| `questions`         | `id` (`qst_…`), `agent_id`, `session_id`, `turn_id`, `text`, `choices JSON`, `ref` (a random 12-byte base64url reference for its buttons), `state` (`open`, `answered`, `closed`), `answer JSON`, `close_reason` (`replaced`, `cleared`, `expired`), `created_at`, `closes_at`, `closed_at`                                                                                        | unique `ref`; unique `(agent_id)` where `state = 'open'` |
| `question_messages` | `question_id`, `surface` (`telegram`, `console`, `mini`), `chat_id`, `topic_id`, `message_id`, `sent_at`                                                                                                                                                                                                                                                                           | PK `(question_id, surface, chat_id)`                     |
| `telegram_owner`    | `id` (always `1`), `user_id` (the Telegram user the bot answers), `paired_at`, `agent_id` (the agent `/use` picked, [decision 0204](../DECISIONS.md#d0204))                                                                                                                                                                                                                        | PK `id`                                                  |
| `telegram_topics`   | `agent_id`, `chat_id`, `thread_id` (the topic's `message_thread_id`), `created_at` ([decision 0186](../DECISIONS.md#d0186))                                                                                                                                                                                                                                                        | PK `(agent_id, chat_id)`                                 |

A notice is stored before any surface sends it, with an `outbox` row for each chat surface the
install runs: `target` `{ "to": "owner" }`, `payload` `{ "notice": <id> }`. A delivery turns
`unknown_after_send` before the surface is called and is never sent again from there; each move
changes the row and the notice's `delivered` in one transaction
([decision 0133](../DECISIONS.md#d0133)). A notice the owner muted is stored with no `outbox` row
and an empty `delivered` ([decision 0185](../DECISIONS.md#d0185)).

`questions` holds the agent's questions to the owner (spec 1, section 7.7): at most one open per
agent, which the partial unique index keeps. The write that answers a question also stores its
`inbox/message` in `agent_inbox`, so the answer reaches the runtime once. `question_messages`
holds each surface's copy, as `card_messages` does for cards, so the buttons can be removed from
every copy after the answer, and after a restart.

`telegram_owner` holds at most one row: the one Telegram user the bot answers. Pairing writes it
and a new pairing replaces it; the bot's copies of each card live in `card_messages`, so both
outlast a restart ([decision 0139](../DECISIONS.md#d0139)). `telegram_topics` holds the topic the
bot made for each agent in the owner's chat while topics are on, so an agent keeps one topic across
restarts; a topic Telegram says is gone loses its row, and the next notice makes a new one
([decision 0186](../DECISIONS.md#d0186)).

<a id="section-2-8"></a>

### 2.8 Access, plugins and operations

| Table                    | Columns                                                                                                                                                                                                                                         | Keys                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `tokens`                 | `id`, `label`, `kind` (`cli`, `runtime`, `mcp`, `custom`), `scopes JSON`, `secret_hash`, `created_at`, `last_used_at`, `revoked_at`, `expires_at`                                                                                               | unique `secret_hash`            |
| `devices`                | `id`, `label`, `alg` (`ed25519`, `p256`), `public_key`, `created_at`, `last_seen_at`, `revoked_at`                                                                                                                                              |                                 |
| `pair_codes`             | `code_hash`, `expires_at`, `used_at`                                                                                                                                                                                                            | PK `code_hash`                  |
| `web_push_subscriptions` | `endpoint`, `device_id`, `p256dh`, `auth`, `server_key` (the VAPID public key it was made for), `created_at`                                                                                                                                    | PK `endpoint`, `(device_id)`    |
| `mini_app_launches`      | `launch_hash` (the SHA-256 of a Mini App launch's `hash` field), `seen_at`                                                                                                                                                                      | PK `launch_hash`, `(seen_at)`   |
| `mini_app_tickets`       | `ticket_hash` (the SHA-256 of a launch ticket `/console` made), `user_id` (the owner's Telegram id), `issued_at`, `expires_at`                                                                                                                  | PK `ticket_hash`, `(issued_at)` |
| `config_journal`         | `id`, `at`, `by`, `surface`, `path`, `before JSON`, `after JSON`, `reason`                                                                                                                                                                      | `(at)`                          |
| `plugins`                | `id`, `name`, `version`, `tier` (`core`, `community`), `source`, `hash`, `permissions JSON`, `enabled`, `installed_at`                                                                                                                          | unique `name`                   |
| `skills`                 | `id`, `agent_id`, `name`, `source`, `hash`, `installed_at`                                                                                                                                                                                      | unique `(agent_id, name)`       |
| `jobs`                   | `id`, `kind`, `state` (`running`, `done`, `failed`), `progress JSON`, `result JSON`, `error JSON`, `started_at`, `ended_at`                                                                                                                     | `(state)`                       |
| `backups`                | `id`, `path`, `bytes`, `kind` (`daily`, `weekly`, `manual`, `before_update`, `before_migration`), `created_at`, `verified_at`, `file_sha256`, `header_sha256` (the digests a restore knows the file by; [decision 0163](../DECISIONS.md#d0163)) | `(created_at)`                  |
| `cex_connections`        | `provider` (`binance`), `state`, `secret_ref` (a keychain name), `scopes JSON`, `connected_at`                                                                                                                                                  | PK `provider`                   |

A token without `expires_at` works until it is revoked ([decision 0159](../DECISIONS.md#d0159)).

`plugins` stays empty: the plugin lock (`plugins/lock.json` in the state folder) is the one record
of installed plugins, and the engine refuses to start a plugin whose files do not hash to its pin,
or whose declarations do not hash to the digest the owner accepted
([decision 0348](../DECISIONS.md#d0348), [ARCHITECTURE.md section 14](../ARCHITECTURE.md#section-14)).

Secrets are never stored here: tokens, webhook secrets and pairing codes appear only as SHA-256
hashes; provider tokens live in the keychain and are named by `secret_ref`.
`web_push_subscriptions` holds each console device's browser push subscriptions: the browser's own
keys, which every message is encrypted to, so they stay as the browser gave them. A device keeps
its newest 4: saving a fifth deletes its oldest, so one device cannot turn a card into a flood of
requests. Revoking a device drops its rows, and the VAPID private key that signs the messages lives in `keys/`, never here
([decision 0158](../DECISIONS.md#d0158)).

`mini_app_launches` holds the Telegram Mini App launches that signed in within the last 24 hours,
as the SHA-256 of each launch's `hash` field and never the launch data. A sign-in checks and writes
it in one transaction and deletes the rows older than 24 hours there, so a launch signs in once,
even after a restart ([decision 0160](../DECISIONS.md#d0160)).

`mini_app_tickets` holds the single-use tickets `/console` put in the Mini App's address, as the
SHA-256 of each ticket and never the ticket, with the Telegram id it was made for and an expiry 5
minutes later. A new ticket deletes the expired rows and the oldest past 16; a Mini App sign-in
deletes its ticket in the transaction that claims its launch
([decision 0161](../DECISIONS.md#d0161)).

<a id="section-3"></a>

## 3. Agent database

| Table               | Columns                                                                                                                                                                                                                                   | Keys and indexes                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `meta`              | `key`, `value`                                                                                                                                                                                                                            | PK `key`                                                |
| `sessions`          | `id`, `agent_id`, `surface`, `conversation` (for example `telegram:<chat>:<topic>`), `started_at`, `cleared_at`, `summary`, `version`, `model` (the chat's own model, [decision 0404](../DECISIONS.md#d0404))                             | `(agent_id, conversation)`                              |
| `turns`             | `id`, `session_id`, `started_at`, `ended_at`, `outcome` (`ok`, `stopped`, `failed`, `budget`, `loop`), `committed`, `outside_content`, `held_back` (propose calls not run, [decision 0167](../DECISIONS.md#d0167)), `model`               | `(session_id, started_at)`                              |
| `chat_queue`        | `message` (`msg_…`), `agent_id`, `session_id`, `kind`, `payload JSON`, `received_at`, `turn_id` (the turn that took it), `dropped_at`, `drop_reason`, `seq` (its write-order key, from `counters`)                                        | PK `message`, `(session_id, received_at)`, unique `seq` |
| `transcript_events` | `id`, `session_id`, `turn_id`, `seq`, `role` (`owner`, `agent`, `tool`, `system`), `kind` (`text`, `tool_call`, `tool_result`, `image`, `summary`), `content JSON`, `outside` (outside content, spec 8 section 5.4), `at`                 | unique `(session_id, seq)`                              |
| `notes`             | `id`, `agent_id`, `text`, `origin` (`owner`, `agent`, `untrusted`, `system`), `created_at`, `changed_at`, `deleted_at`                                                                                                                    | `(agent_id)`                                            |
| `helpers`           | `id` (the helper's own session), `agent_id`, `parent_session_id`, `label`, `model`, `state` (`running`, `done`, `failed`, `stopped`, `timed_out`), `started_at`, `ended_at`, `timeout_ms`, `runs`, `outside`                              | PK `id`, `(agent_id, started_at)`                       |
| `goals`             | `session_id` (the chat's session), `agent_id`, `objective`, `status` (`active`, `paused`, `blocked`, `complete`), `pause_reason`, `note`, `budget_micros`, `spent_micros`, `goal_turns`, `strikes`, `started_at`, `updated_at`, `version` | PK `session_id`                                         |
| `progress_notes`    | `session_id`, `agent_id`, `markdown`, `plan JSON` (each step's `text` and `state`: `done`, `doing`, `todo`), `updated_at`                                                                                                                 | PK `session_id`                                         |
| `notes_fts`         | FTS5 over `notes.text`, kept in step by triggers                                                                                                                                                                                          |                                                         |
| `counters`          | `name`, `last` (the last write-order key it gave)                                                                                                                                                                                         | PK `name`                                               |

`meta` holds the writer fence (`writer_fence`), raised at each runtime start and checked by every
transcript write ([spec 8, section 2.3](runtime.md#section-2-3)). Triggers refuse every change of
a `transcript_events` row, and every removal but the retention job's, which sets
`meta.prune_before` to its cutoff inside its own transaction
([decision 0169](../DECISIONS.md#d0169)). `notes_fts` uses FTS5's trigram tokenizer, so a query of
three characters or more finds a word inside Chinese text. `agent_inbox` in the engine
database holds each message for the runtime until the runtime takes it into `chat_queue`
([spec 8, section 3.2](runtime.md#section-3-2)).

A helper ([decision 0403](../DECISIONS.md#d0403)) works in a session of its own, which its row
names and opens in the same write, with `surface` `helper`; its turns and transcript are that
session's. `state` leaves `running` only for an end, which sets `ended_at`, and a follow-up moves
it back to `running` with a new `started_at`, no `ended_at` and one more of `runs`. `outside` is
set once any run of it read outside content, and never clears.

A chat has at most one goal and one progress note ([decision 0407](../DECISIONS.md#d0407)), each
under its session's id. `pause_reason` is set exactly while the goal is `paused`; `budget_micros`
and `spent_micros` are decimal micro-dollars, `strikes` counts goal turns in a row that made no
progress, and each write raises `version` from the one its writer read. A progress note is replaced
whole, and one with no markdown and no step is removed.

Notes never hold a contract or token address as a source for actions
([rule 10](../ARCHITECTURE.md#rule-10)); the runtime does not pass note text to propose tools as an
address ([decision 0206](../DECISIONS.md#d0206)). A query under three characters finds the notes
whose text holds it.

<a id="section-4"></a>

`counters` counts, as in the engine database, the write-order key `chat_queue.seq`, which an
insert trigger sets ([decision 0366](../DECISIONS.md#d0366)).

## 4. Retention

A daily job (inside the engine's schedule queue) prunes:

| What                                                                                                                                                                          | Kept                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ledger`, `executions`, `arrivals`, `departures`, `positions`, `intents`, `txs`, `cards`, `confirmations`, `late_landings`, `carried_outflows`, `stake_unbondings`, `bridges` | forever                                                            |
| `transcript_events`, `turns`, `chat_queue`                                                                                                                                    | 90 days ([decision 0056](../DECISIONS.md#d0056); `chats.keepDays`) |
| `idempotency`                                                                                                                                                                 | 24 hours                                                           |
| `mini_app_launches`                                                                                                                                                           | 24 hours, deleted at each Mini App sign-in                         |
| `mini_app_tickets`                                                                                                                                                            | 5 minutes, deleted at each new ticket; a sign-in deletes its own   |
| `inbox` handled, `outbox` sent, `agent_inbox` taken                                                                                                                           | 30 days                                                            |
| `webhook_events`                                                                                                                                                              | 90 days                                                            |
| `schedule_runs`                                                                                                                                                               | 90 days                                                            |
| `notices`                                                                                                                                                                     | 90 days                                                            |
| `launches`, `wallet_activity`                                                                                                                                                 | 90 days                                                            |
| `tracked_wallets` untracked                                                                                                                                                   | 90 days after `untracked_at`                                       |
| `questions` and their `question_messages`, once closed or answered                                                                                                            | 30 days                                                            |
| `model_usage`, `budget_notices`                                                                                                                                               | 400 days                                                           |
| `daily_summaries`                                                                                                                                                             | forever, one row per agent and day                                 |
| `prices`, `risk_cache`, `watch_cursors`                                                                                                                                       | replaced in place                                                  |
| `jobs` ended                                                                                                                                                                  | 30 days                                                            |

`binference reset` clears every table of the agent database but `meta`, and in the engine
database `agent_inbox`, `questions`, `question_messages` and `risk_cache`, after a backup and with
the engine stopped ([decision 0265](../DECISIONS.md#d0265)).

<a id="section-5"></a>

## 5. Integrity checks

`binference check` runs, per database: `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, the
ledger chain walk, the unique-nonce index check, and a comparison of `schema_version` with the
binary's expected version. `check --fix` runs `VACUUM` and `ANALYZE` after a backup when free pages
exceed 20%.

<a id="section-6"></a>

## 6. Postgres

Approved by the owner on 2026-11-05, on decisions [0365](../DECISIONS.md#d0365),
[0366](../DECISIONS.md#d0366) and [0367](../DECISIONS.md#d0367). Sections 1 to 5 stay the SQLite
databases as they are. This section adds their Postgres form, which the public Postgres store
adapter implements, passing the same contract suites. Self-hosted runs SQLite only in v1. A part
marked **Cloud only** exists only in bInference Cloud.

<a id="section-6-1"></a>

### 6.1 Server and driver

Postgres 17 or later, through Kysely's built-in `PostgresDialect` on `pg`
([decision 0365](../DECISIONS.md#d0365)). Every connection uses TLS with the server's CA checked,
except to the loopback address or a Unix socket. Each session sets `statement_timeout` 5 s,
`lock_timeout` 2 s, `idle_in_transaction_session_timeout` 2 s, `TimeZone` UTC, an empty
`search_path` and an `application_name` that names the service. The one extension the store needs
is `pg_trgm`, for note search.

Every write task runs at `SERIALIZABLE`, read write; every read task at `REPEATABLE READ`, read
only. A write that fails with SQLSTATE `40001` or `40P01` runs again from its first read, at most
three times more; then it fails `store.write_conflict`. A write that fails with `23505` or
`23P01`, a key another write took, runs again once from its first read, within the same three,
and fails `store.constraint` when it meets one again ([decision 0413](../DECISIONS.md#d0413)). A
write task that inserts a key its caller chose reads that key first, so its rerun finds the row and
gives the store port's own answer. A connection lost while `COMMIT` is in flight fails
`store.commit_unknown` and is never retried. The worker keeps one writer per database: an
install's write tasks run one at a time, in arrival order ([decision 0366](../DECISIONS.md#d0366)).

<a id="section-6-2"></a>

### 6.2 Schemas

Each install keeps its engine tables in schema `engine_<install>` and its agent tables in
`agent_<install>`, where `<install>` is the 32 lowercase hex digits of `meta.install_id`
([decision 0367](../DECISIONS.md#d0367)). Each schema holds every table of its SQLite database, by
the same name, with its own `meta` and `schema_version`, and the `counters` table of section 6.3.
Every query names its schema. The same numbered migrations run on each install's schemas, each in
one transaction with its version bump, and a build refuses an install whose schema version is newer
than it knows ([decision 0062](../DECISIONS.md#d0062)).

**Cloud only:** one Cloud database holds every user's install, each in its own pair of schemas, and
the shared schema `cloud`, which holds `agent_leases` (section 6.5) and no install's data.

<a id="section-6-3"></a>

### 6.3 Types and checks

Every column reads back as the value SQLite gives, so the store's row types and zod schemas serve
both adapters.

| SQLite                                                                          | Postgres                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `INTEGER` time, epoch milliseconds (`_at` and the other times)                  | `bigint`                                                                                  |
| `INTEGER` flag, `CHECK (x IN (0, 1))`                                           | `smallint CHECK (x IN (0, 1))`                                                            |
| Any other `INTEGER`: counts, basis points, nonces, versions, Telegram ids       | `bigint`, with the same `CHECK`                                                           |
| `TEXT` decimal base units, USD micros and block numbers (the digits-only check) | `numeric(78,0) CHECK (x >= 0)`; a `realized_usd_micros` may be below zero                 |
| `TEXT` JSON, `CHECK (json_valid(x))`                                            | `text COLLATE "C" CHECK (x IS JSON)`; `IS JSON ARRAY` where SQLite checks an array        |
| Any other `TEXT`                                                                | `text COLLATE "C"`; a `GLOB` check becomes the same pattern as a regular expression (`~`) |
| `INTEGER PRIMARY KEY` or `AUTOINCREMENT`, a write-order key                     | `bigint` primary key, set by an insert trigger from `counters` (below)                    |
| A singleton row, `id INTEGER PRIMARY KEY CHECK (id = 1)`                        | `bigint PRIMARY KEY CHECK (id = 1)`                                                       |
| A unique or partial index                                                       | The same index, with the same `WHERE`                                                     |
| A trigger that raises (the ledger, the transcript)                              | A PL/pgSQL trigger that raises the same message                                           |
| `notes_fts`, FTS5 with the trigram tokenizer                                    | A `pg_trgm` GIN index on `notes.text`                                                     |
| `json_extract(x, '$.a.b')` in a query                                           | `x::jsonb #>> '{a,b}'`                                                                    |

`numeric(78,0)` reads back as the decimal text SQLite stores. Text compares byte by byte under
`COLLATE "C"`, as on SQLite, so a sort, an equality and a prefix range match the same rows.

`counters` holds `name text COLLATE "C" PRIMARY KEY` and `last bigint NOT NULL`, one row per
write-order key. An insert into a table with such a key takes `last + 1` from its row in the same
transaction, so keys follow the order transactions commit and are never reused. No table uses an
identity column or a sequence ([decision 0366](../DECISIONS.md#d0366)). SQLite keeps the same
`counters` table in each database that has such a key, and the key's insert trigger takes
`last + 1` there the same way.

The ledger's insert trigger checks that `seq` is the next key and `prev_hash` the hash of the entry
before it; its update and delete triggers refuse, and no role holds `UPDATE` or `DELETE` on it. The
transcript's triggers refuse an update, and a removal at or after `meta.prune_before`, as on SQLite.

Section 5's checks become, on Postgres: the ledger chain walk, the unique-nonce index check and the
schema version. Page checks, `VACUUM` and backups are the database service's; on Cloud the managed
database keeps backups and restores to a point in time
([ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)).

<a id="section-6-4"></a>

### 6.4 Tables

Every table of the migrated schema. A column not named here maps by section 6.3. A write-order key
is set from `counters`. A `seq` column came to SQLite with the migration it names, which numbered
the rows already stored in the order the store read them ([decision 0366](../DECISIONS.md#d0366)).

In the engine schema:

| Table                    | Write-order key     | `numeric(78,0)`                                                                                                                                                        | JSON text                                                                   | Also                                                                  |
| ------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `address_book`           |                     |                                                                                                                                                                        |                                                                             | Partial unique `(agent_id, chain, address)` while not removed         |
| `agent_inbox`            | `seq` (engine 0062) |                                                                                                                                                                        | `payload`                                                                   |                                                                       |
| `agents`                 |                     |                                                                                                                                                                        | `models`, `notifications`                                                   | Cloud: a trigger keeps `mode` from `paper` to `live` to the ingress   |
| `alert_fires`            |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `alerts`                 |                     |                                                                                                                                                                        | `condition`                                                                 |                                                                       |
| `approval_modes`         |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `arrivals`               | `id`                | `amount`, `value_usd_micros`                                                                                                                                           |                                                                             |                                                                       |
| `backups`                |                     |                                                                                                                                                                        |                                                                             | Unused on Cloud                                                       |
| `bridges`                |                     | `sent_amount`, `min_out`, `value_usd_micros`, `received`                                                                                                               |                                                                             | Partial uniques on `(to_chain, fill_tx)` and `refund_tx`              |
| `budget_notices`         |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `card_messages`          |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `cards`                  |                     |                                                                                                                                                                        | `place`                                                                     |                                                                       |
| `carried_outflows`       |                     | `value_usd_micros`                                                                                                                                                     |                                                                             |                                                                       |
| `ceilings`               |                     | `per_tx_native`                                                                                                                                                        | `policy`                                                                    |                                                                       |
| `cex_connections`        |                     |                                                                                                                                                                        | `scopes`                                                                    |                                                                       |
| `config_journal`         | `id`                |                                                                                                                                                                        | `before`, `after`                                                           |                                                                       |
| `confirmations`          |                     |                                                                                                                                                                        |                                                                             | Foreign key `(intent_id, card_version)` to `cards`                    |
| `counters`               |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `custody`                |                     |                                                                                                                                                                        |                                                                             | Singleton                                                             |
| `daily_summaries`        |                     | `live_usd_micros`, `paper_usd_micros`                                                                                                                                  |                                                                             |                                                                       |
| `departures`             | `id`                | `amount`, `gas_amount`                                                                                                                                                 |                                                                             |                                                                       |
| `devices`                |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `engine_alive`           |                     |                                                                                                                                                                        |                                                                             | Singleton                                                             |
| `credentials`            |                     |                                                                                                                                                                        |                                                                             | Per install                                                           |
| `shell_allowed`          |                     |                                                                                                                                                                        |                                                                             | Per install                                                           |
| `shell_watches`          |                     |                                                                                                                                                                        |                                                                             | Per install                                                           |
| `executions`             | `id`                | `amount_in`, `fee_amount`, `amount_out`, `gas_amount`, `value_usd_micros`, `fee_usd_micros`, `gas_usd_micros`, `realized_usd_micros` (signed)                          |                                                                             |                                                                       |
| `idempotency`            |                     |                                                                                                                                                                        | `result`                                                                    |                                                                       |
| `identities`             |                     | `onchain_id`                                                                                                                                                           |                                                                             |                                                                       |
| `inbox`                  | `id`                |                                                                                                                                                                        | `payload`                                                                   | Partial index on `handled_at`                                         |
| `intent_events`          | `id`                |                                                                                                                                                                        | `cause`                                                                     |                                                                       |
| `intents`                |                     | `value_usd_micros`                                                                                                                                                     | `request`, `plan`, `quote`, `risk`, `simulation`, `authorized_by`, `assets` | Partial unique on `draft_ref`                                         |
| `jobs`                   |                     |                                                                                                                                                                        | `progress`, `result`, `error`                                               |                                                                       |
| `late_landings`          |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `launches`               |                     | `block`                                                                                                                                                                | `insiders` (an array)                                                       |                                                                       |
| `ledger`                 | `seq`               |                                                                                                                                                                        | `data`                                                                      | Append-only triggers (section 6.3)                                    |
| `limits`                 |                     | `per_trade_usd_micros`, `rolling_day_usd_micros`, `liquidity_floor_usd_micros`, `model_budget_usd_micros`, `copy_per_buy_usd_micros`, `copy_per_leader_day_usd_micros` | `gas_reserve`, `venues`, `allow_tokens`, `deny_tokens`, `pending`           |                                                                       |
| `meta`                   |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `mini_app_launches`      |                     |                                                                                                                                                                        |                                                                             | Unused on Cloud                                                       |
| `mini_app_tickets`       |                     |                                                                                                                                                                        |                                                                             | Unused on Cloud                                                       |
| `model_usage`            | `id`                | `usd_micros`                                                                                                                                                           |                                                                             |                                                                       |
| `nonces`                 |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `notices`                | `seq` (engine 0061) |                                                                                                                                                                        | `values`, `delivered`                                                       |                                                                       |
| `order_fills`            | `seq` (engine 0060) |                                                                                                                                                                        | `notices`                                                                   | Partial index on unannounced rows                                     |
| `orders`                 |                     |                                                                                                                                                                        | `request`, `trigger_state`                                                  | Unique `intent_id`                                                    |
| `outbox`                 | `id`                |                                                                                                                                                                        | `target`, `payload`                                                         |                                                                       |
| `pair_codes`             |                     |                                                                                                                                                                        |                                                                             | Unused on Cloud                                                       |
| `plugins`                |                     |                                                                                                                                                                        | `permissions`                                                               |                                                                       |
| `positions`              |                     | `quantity`, `cost_usd_micros`, `realized_usd_micros` (signed)                                                                                                          |                                                                             |                                                                       |
| `prices`                 |                     | `usd_micros`                                                                                                                                                           |                                                                             |                                                                       |
| `question_messages`      |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `questions`              |                     |                                                                                                                                                                        | `choices`, `answer`                                                         | Partial unique on `agent_id` while open                               |
| `risk_cache`             |                     |                                                                                                                                                                        | `result`                                                                    |                                                                       |
| `safety`                 |                     |                                                                                                                                                                        | `rescue_ceiling`, `rescue_reach` (an array)                                 | Singleton                                                             |
| `schedule_runs`          |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `schedules`              |                     |                                                                                                                                                                        | `when`                                                                      |                                                                       |
| `send_levels`            |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `skills`                 | `id`                |                                                                                                                                                                        |                                                                             |                                                                       |
| `stake_unbondings`       | `id`                | `amount`, `value_usd_micros`                                                                                                                                           |                                                                             | Partial indexes as on SQLite                                          |
| `telegram_owner`         |                     |                                                                                                                                                                        |                                                                             | Singleton; unused on Cloud                                            |
| `telegram_topics`        |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `tokens`                 |                     |                                                                                                                                                                        | `scopes`                                                                    |                                                                       |
| `tracked_wallets`        |                     | `since_block`, `last_block`                                                                                                                                            |                                                                             |                                                                       |
| `tx_sends`               |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `txs`                    |                     | `gas_price`                                                                                                                                                            | `relays`, `receipt`                                                         | Partial unique `(account, nonce)` while signed, sent, included, final |
| `wallet_activity`        | `id`                | `block`, `amount`, `counter_amount`, `value_usd_micros`                                                                                                                |                                                                             |                                                                       |
| `wallets`                |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `watch_cursors`          |                     | `block`                                                                                                                                                                |                                                                             |                                                                       |
| `web_push_subscriptions` |                     |                                                                                                                                                                        |                                                                             |                                                                       |
| `webhook_events`         | `id`                |                                                                                                                                                                        | `notices`                                                                   | Partial unique on `intent_id`                                         |
| `webhook_rules`          |                     |                                                                                                                                                                        | `action`                                                                    | Partial unique on `intent_id`                                         |

In the agent schema:

| Table               | Write-order key    | JSON text | Also                                                   |
| ------------------- | ------------------ | --------- | ------------------------------------------------------ |
| `chat_queue`        | `seq` (agent 0005) | `payload` |                                                        |
| `counters`          |                    |           |                                                        |
| `goals`             |                    |           | Money in `numeric(78,0)`                               |
| `helpers`           |                    |           |                                                        |
| `meta`              |                    |           | Holds `writer_fence` and `prune_before`, as on SQLite  |
| `notes`             | `id`               |           | `pg_trgm` GIN index on `text`, in place of `notes_fts` |
| `progress_notes`    |                    | `plan`    |                                                        |
| `sessions`          |                    |           |                                                        |
| `transcript_events` | `id`               | `content` | Refuse-change triggers (section 6.3)                   |
| `turns`             |                    |           |                                                        |

<a id="section-6-5"></a>

### 6.5 Agent leases

**Cloud only.** The lease unit is the install, because one engine and one agent runtime serve an
install. A worker holds an install, with every agent in it, through the install's rows of
`cloud.agent_leases`, one row per agent, and every write a worker makes in the install's schemas
carries the lease's fence, so a worker that lost the lease writes nothing
([ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)).

| Column       | Type               | Holds                                                         |
| ------------ | ------------------ | ------------------------------------------------------------- |
| `install_id` | `text COLLATE "C"` | The install's `ins_` id                                       |
| `agent_id`   | `text COLLATE "C"` | The agent's `agt_` id                                         |
| `worker_id`  | `text COLLATE "C"` | The worker process holding it, unique per start; NULL if free |
| `fence`      | `bigint`, `>= 1`   | Raised by one at every take                                   |
| `taken_at`   | `bigint`           | When the holder took it                                       |
| `renewed_at` | `bigint`           | The holder's last renewal                                     |
| `expires_at` | `bigint`           | When it frees unless renewed                                  |

Primary key `(install_id, agent_id)`; an index on `expires_at` for the take scan.

- **The database's clock.** Every time in a lease rule is the database's `clock_timestamp()` in
  epoch milliseconds, never a worker's clock.
- **One install, one holder.** A worker takes every row of an install in one transaction, and all
  its rows carry the same fence. A take sets `worker_id`, `fence = fence + 1`, `taken_at`,
  `renewed_at` and `expires_at`, and succeeds only while every row of the install has expired.
  `create_install()` (section 6.6) inserts a new install's first rows free, with `expires_at` at
  zero and fence 1. The holder inserts the row of a new agent with the install's fence, and
  deletes the row of a deleted agent.
- **Renewal.** The holder renews every 2 seconds, setting `expires_at` 6 seconds ahead, only where
  `worker_id` and `fence` are its own. A renewal that changes no row means the lease is lost: the
  worker stops the install's engine and runtime at once and writes nothing more. A clean stop sets
  `expires_at` to now. 2 and 6 seconds are starting values the failover suite tunes, so that a dead
  worker's agents move within 10 seconds.
- **The fence on every write.** A worker's write task's first statement, in its own transaction,
  reads the install's rows `FOR SHARE`. Unless there are rows and each names this worker and its
  fence and has not expired, the task fails `store.lease_lost` and changes nothing. A take updates
  the rows, so it waits until every write that passed the check has ended; no write that passed
  commits after another worker holds the install.
- **A paused worker.** A worker paused inside a transaction loses it to
  `idle_in_transaction_session_timeout`, which frees its locks; its next write fails the fence
  check.
- **The writer fence stays.** `meta.writer_fence` in the agent schema still guards the runtime
  within a worker ([spec 8, section 2.3](runtime.md#section-2-3)); the lease fence guards both
  schemas across workers.
- **Self-hosted** keeps no lease row: the engine lock holds the state folder. The lease port's
  in-memory fake holds one lease for the self-hosted root.

<a id="section-6-6"></a>

### 6.6 Database roles

**Cloud only.** Each Cloud service connects with its own role, and no role holds another's grants
([ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)). Secrets never live in the database:
keys stay in KMS and the platform's secret store.

| Role                     | Used by                          | On each install's schemas                                                                                                                                                                                                                                                                                                                                     | On `cloud`                                 |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `binference_migrator`    | Deploys only                     | Owns every install's schemas and tables; runs the migrations                                                                                                                                                                                                                                                                                                  | Owns `agent_leases` and `create_install()` |
| `binference_provisioner` | Sign-up only                     | None: it owns nothing and holds only `EXECUTE` on `create_install()`                                                                                                                                                                                                                                                                                          | None                                       |
| `binference_worker`      | The workers                      | `SELECT`, `INSERT`, `UPDATE` and `DELETE` on every table but these: `confirmations`, `ceilings`, `custody`, `wallets`, `address_book` and `meta` read only; `ledger` read and insert only; on `safety` it updates only `frozen_at`, `rescue_reach` and `version`                                                                                              | Reads and writes `agent_leases`            |
| `binference_ingress`     | The official bot and the console | Inserts and replaces `confirmations` from a user's tap; inserts `inbox` and `webhook_events` and sets `webhook_rules.last_alert_at`; writes the owner-key records (`wallets`, `ceilings`, `custody`, `address_book`, and on `safety` the rescue address, its pending change, `rescue_ceiling` and the disclaimer); sets `agents.mode`; reads what these check | Reads `agent_leases`, to reach the holder  |
| `binference_signer`      | The signer service               | Reads `intents`, `cards`, `confirmations`, `orders`, `wallets`, `ceilings`, `limits`, `agents`, `safety` and `txs`; writes nothing                                                                                                                                                                                                                            | None                                       |
| `binference_catalog`     | The listing catalog              | None                                                                                                                                                                                                                                                                                                                                                          | None                                       |

- `create_install(install_id)` is a `SECURITY DEFINER` function the migrator owns, in schema
  `cloud`. It refuses when either of the install's schemas exists; otherwise it creates the pair,
  owned by the migrator, runs the migrations in them and inserts the install's first lease rows.
  A compromised sign-up path can therefore make a new install but cannot touch an existing one.
- No service but a deploy connects as the migrator, and the migrator is a member of no other role.
- No role holds `UPDATE` or `DELETE` on `ledger`.
- A worker cannot insert a confirmation, change a ceiling record, sign or read a key. The ingress
  cannot sign: it holds no key and cannot write `txs`.
- How a confirmation, a ceiling read-back and a rescue change reach these rows on Cloud is not
  this spec's: spec 5 and spec 1 specify them with the signer service and the Cloud surfaces.
- Two moves a worker makes on rows it may not write run as `SECURITY DEFINER` functions the
  migrator owns, each checking its own rule: `apply_due_rescue()` moves a pending rescue address
  into `safety.rescue_address` once `pending_rescue_at` has passed, and `raise_writer_fence()`
  raises `meta.writer_fence`.
- A trigger on `agents` refuses `mode` from `paper` to `live` for any role but the ingress, since
  going live happens on binference.io.
- `counters` takes `UPDATE` from every role that inserts into a table with a write-order key.
- The signer service's own tables and the listing catalog's tables are specified with them, in their
  own schemas; no other role reads them.

<a id="section-6-7"></a>

### 6.7 The order of each ordered read

Every ordered read sorts on columns the schema holds and ends unique among the rows it reads
([decision 0366](../DECISIONS.md#d0366)). A UUIDv7 id at the end gives the same order on both
databases, but rows of one millisecond read in the order of its random bits, not the order they were
written; "id tie" marks such a read. Each order here gets a contract case on both adapters.

In the engine schema:

| Table                              | Read                                       | Order                                                                  | Today                                                                                        |
| ---------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `address_book`                     | An agent's saved addresses                 | `created_at`, `id`                                                     | Id tie                                                                                       |
| `agent_inbox`                      | Untaken messages, paged                    | `seq`                                                                  | Write-order key since engine 0062                                                            |
| `agents`                           | Every agent; the restore guards            | `created_at`, `id`; `id`                                               | Id tie                                                                                       |
| `alert_fires`                      | An agent's rows past the newest 1,000      | `at` descending                                                        | Deletes by the time it finds, so a tie keeps the same rows                                   |
| `alerts`                           | Pages, an agent's, the expiring            | `created_at`, `id`; `expires_at`, `id`                                 | Id tie                                                                                       |
| `backups`                          | Every backup                               | `created_at`, `id`                                                     | Id tie                                                                                       |
| `bridges`                          | Open bridges, paged                        | `sent_at`, `intent_id`                                                 | Id tie                                                                                       |
| `card_messages`                    | A card's copies; an intent's copies        | (`cards.version`), `sent_at`, `message_id`, `surface`                  | Not unique without `surface`                                                                 |
| `cards`                            | An intent's cards                          | `version`                                                              | Unique                                                                                       |
| `config_journal`                   | Entries after a number                     | `id`                                                                   | Write-order key                                                                              |
| `confirmations`, `intents`         | Confirmed outflows of a day                | `at`, `intents.id`                                                     | Id tie                                                                                       |
| `daily_summaries`                  | An agent's last summary                    | `date` descending                                                      | Unique for the agent                                                                         |
| `departures`                       | An intent's departures                     | `id`                                                                   | Write-order key                                                                              |
| `devices`                          | Every device                               | `created_at`, `id`                                                     | Id tie                                                                                       |
| `executions`, `arrivals`           | A position's rows                          | `id`                                                                   | Write-order key                                                                              |
| `inbox`                            | Unhandled entries of a key prefix          | `id`                                                                   | Write-order key; the prefix range needs byte order                                           |
| `intent_events`                    | An intent's events; its first cause        | `id`                                                                   | Write-order key                                                                              |
| `intents`                          | Pages; the newest; fills in flight         | `changed_at`, `id`; `created_at`, `id` descending                      | Id tie                                                                                       |
| `launches`                         | The launch feed                            | `launched_at`, `block`, `log_index`, `chain`, `token`, each descending | Not unique across chains; `block` cast to an integer                                         |
| `ledger`                           | The chain walk; the head                   | `seq`                                                                  | Write-order key                                                                              |
| `mini_app_tickets`                 | The oldest past 16                         | `issued_at`, `ticket_hash`, descending                                 | Unique                                                                                       |
| `model_usage`                      | Spend by agent and model                   | `agent_id`, `model`                                                    | Unique per group                                                                             |
| `notices`                          | Notices after a cursor                     | `seq`                                                                  | Write-order key since engine 0061                                                            |
| `order_fills`                      | An order's fills, the newest written first | `at`, `seq`, descending                                                | Write-order key since engine 0060                                                            |
| `order_fills`                      | Fills whose notices wait                   | `at`, `seq`                                                            | Write-order key since engine 0060                                                            |
| `order_fills`, `orders`, `intents` | A leader's copy buys, paged                | `fill.seq`                                                             | Write-order key since engine 0060; the page's cursor is a `seq`, so the order is `seq` alone |
| `order_fills`                      | Skip counts by reason                      | count descending, `reason`                                             | Unique per group                                                                             |
| `orders`                           | Pages                                      | `created_at`, `id`                                                     | Id tie                                                                                       |
| `outbox`                           | Queued deliveries                          | `id`                                                                   | Write-order key                                                                              |
| `positions`                        | A wallet's positions in one mode           | `asset`                                                                | Unique for the wallet and mode                                                               |
| `question_messages`                | A question's copies                        | `sent_at`, `chat_id`, `surface`                                        | Not unique without `surface`                                                                 |
| `schedules`                        | An agent's; the due                        | `created_at`, `id`; `next_at`, `id`                                    | Id tie                                                                                       |
| `stake_unbondings`                 | Open unbondings                            | `ready_at`, `id`                                                       | Write-order key                                                                              |
| `tokens`                           | Every token                                | `created_at`, `id`                                                     | Id tie                                                                                       |
| `tracked_wallets`                  | Tracked accounts                           | `account`                                                              | Unique                                                                                       |
| `tx_sends`                         | A transaction's sends                      | `attempt`, `place`                                                     | Unique                                                                                       |
| `txs`                              | An account's by nonce; an intent's by step | `nonce`, `id`; `step`, `id`                                            | Id tie                                                                                       |
| `wallet_activity`                  | A wallet's trades: pages, the newest       | `at`, `id`, descending; `id`                                           | Write-order key                                                                              |
| `wallets`                          | The install's wallets                      | `created_at`, `id`                                                     | Id tie, where the first wallet of a role is the one its agent uses                           |
| `web_push_subscriptions`           | A device's newest 4; its oldest            | `created_at`, `endpoint`                                               | Unique                                                                                       |
| `webhook_events`                   | A rule's events, paged; the unannounced    | `id` descending; `id`                                                  | Write-order key                                                                              |
| `webhook_rules`                    | Pages                                      | `created_at`, `id`                                                     | Id tie                                                                                       |

In the agent schema:

| Table               | Read               | Order                | Today                                               |
| ------------------- | ------------------ | -------------------- | --------------------------------------------------- |
| `chat_queue`        | A session's queue  | `seq`                | Write-order key since agent 0005                    |
| `helpers`           | An agent's helpers | `started_at`, `id`   | Id tie                                              |
| `notes`             | An agent's notes   | `id`                 | Write-order key                                     |
| `notes`             | A search           | relevance, then `id` | The relevance is each adapter's own (decision 0366) |
| `transcript_events` | A session's events | `seq`                | Unique per session                                  |
| `turns`             | A session's turns  | `started_at`, `id`   | Id tie                                              |
