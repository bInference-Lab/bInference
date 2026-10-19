# Spec 3: the databases

Status: accepted on 2026-10-06 ([decision 0095](../DECISIONS.md#d0095)), amended by decisions
[0127](../DECISIONS.md#d0127), [0133](../DECISIONS.md#d0133), [0185](../DECISIONS.md#d0185),
[0186](../DECISIONS.md#d0186), [0189](../DECISIONS.md#d0189), [0220](../DECISIONS.md#d0220), [0244](../DECISIONS.md#d0244), [0245](../DECISIONS.md#d0245), [0249](../DECISIONS.md#d0249), [0250](../DECISIONS.md#d0250) and [0251](../DECISIONS.md#d0251); the agent runtime's additions
follow [spec 8](runtime.md) (accepted 2026-10-11). Accepted by the owner on 2026-10-12: `launches`,
`tracked_wallets` and its cap, `wallet_activity` and `watch_cursors` (section 2.6); `questions`
and `question_messages` (section 2.7); `orders.end_reason` and `alerts.wake`, `fires` and
`expires_at` (section 2.4); the versions of `safety.disclaimer_version` (section 2.1); and their
retention (section 4).

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

| Table     | Columns                                                                                                                                                                                                                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta`    | `key TEXT PK`, `value TEXT`. Keys: `schema_version`, `install_id`, `created_at`                                                                                                                                                                                                                                               |
| `safety`  | one row, `id = 1`: `frozen_at`, `rescue_address`, `pending_rescue_address`, `pending_rescue_at`, `disclaimer_version`, `disclaimer_accepted_at`, `version`                                                                                                                                                                    |
| `custody` | one row, `id = 1` (spec 5): `provider` (`privy`), `app_id`, `owner_quorum_id`, `owner_key_public`, `agent_quorum_id`, `agent_key_public`, `attached_at`, `version`, `seal_key_public` (the sealing key's public half, NULL until the owner key derived it; [decision 0164](../DECISIONS.md#d0164)). No secret is stored here. |

`safety.disclaimer_version` holds the version of the disclaimer and privacy statement the owner
accepted (spec 4, section 9), as decimal text, and `disclaimer_accepted_at` when: `1` for the text
of `binference live` before 2026-10-12, `2` for the text with the wider privacy statement. An
install whose stored version is below the current one asks again before an agent goes live. A
stored version never goes down ([decision 0220](../DECISIONS.md#d0220)).

<a id="section-2-2"></a>

### 2.2 Agents, wallets and settings

| Table            | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Keys and indexes                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `agents`         | `id`, `name`, `mode` (`paper`, `live`), `frozen_at`, `archived_at`, `locale`, `models JSON`, `notifications JSON` (`{ muted, dailySummaryTime }`, [decision 0185](../DECISIONS.md#d0185)), `chat_session_id` (the open chat session, NULL until the first message; [spec 8, section 3.1](runtime.md#section-3-1)), `created_at`, `changed_at`, `version`                                                                                                                                                                                                                                                                                                                                          | PK `id`; unique `name`                                         |
| `limits`         | `agent_id`, `per_trade_usd_micros`, `rolling_day_usd_micros`, `slippage_registry_bps`, `slippage_other_bps`, `price_impact_bps`, `tax_bps`, `liquidity_floor_usd_micros`, `min_health_factor_bp` (1.5 is 15000), `gas_reserve JSON` (per chain, base units), `venues JSON`, `allow_tokens JSON`, `deny_tokens JSON`, `model_budget_usd_micros`, `card_trade_expiry_s`, `card_other_expiry_s`, `requote_after_s`, `requote_tolerance_bps`, `order_expiry_days`, `copy_per_buy_usd_micros`, `copy_per_leader_day_usd_micros`, `changed_at`, `version`, `pending JSON` (the looser limits that wait, in the encoding of the columns before it, [decision 0111](../DECISIONS.md#d0111)), `pending_at` | PK `agent_id` → `agents`                                       |
| `approval_modes` | `agent_id`, `mode` (`manual`, `auto`), `changed_by_surface`, `changed_at`, `version` ([decision 0088](../DECISIONS.md#d0088))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | PK `agent_id`                                                  |
| `send_levels`    | `agent_id`, `level`, `pending_level`, `pending_at`, `changed_at`, `version`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | PK `agent_id`                                                  |
| `address_book`   | `id`, `agent_id`, `chain`, `address`, `label`, `usable_at`, `in_ceiling_at` (when the owner key saved it in the Privy policy, [decision 0091](../DECISIONS.md#d0091)), `created_at`, `removed_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | unique `(agent_id, chain, address)` where `removed_at IS NULL` |
| `wallets`        | `id`, `agent_id`, `family` (`evm`), `custody` (`privy`), `custody_wallet_id`, `policy_id`, `signer_id`, `address`, `label`, `created_at`, `archived_at`, `role` (`agent`, `launch`: decisions 0217 and 0218; an agent may hold more than one live launch wallet after a rebuild, the first its launch wallet)                                                                                                                                                                                                                                                                                                                                                                                     | unique `custody_wallet_id`; unique `address`                   |
| `ceilings`       | `wallet_id`, `policy_id`, `policy JSON` (a mirror of the wallet's Privy policy, read back after every change), `per_tx_native` (base units), `read_at`, `version`; the policy step refuses with `ceiling` before Privy would (spec 6)                                                                                                                                                                                                                                                                                                                                                                                                                                                             | PK `wallet_id`                                                 |
| `nonces`         | `account` (CAIP-10), `next_nonce`, `changed_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | PK `account`                                                   |
| `identities`     | `agent_id`, `chain`, `registry`, `onchain_id`, `tx_hash`, `registered_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | PK `agent_id`                                                  |

<a id="section-2-3"></a>

### 2.3 Intents, cards and transactions

| Table              | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Keys and indexes                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `intents`          | `id`, `agent_id`, `wallet_id`, `kind`, `state`, `reason`, `request JSON`, `plan JSON`, `quote JSON`, `risk JSON`, `simulation JSON`, `authorized_by JSON`, `outside_content`, `paper`, `proposer` (`tok_…`, `dev_…`, `telegram`, `engine`), `value_usd_micros` (what the policy judged the outflows worth, which the 24-hour cap counts from the confirmation, [decision 0136](../DECISIONS.md#d0136); null when the policy valued nothing), `assets JSON` (what each token it names and the registry does not list answered on chain at the proposal, marked unverified, which its cards show, [decision 0199](../DECISIONS.md#d0199); null when it names none), `created_at`, `changed_at`, `version` | `(agent_id, state)`; `(state, changed_at)`                                                                   |
| `intent_events`    | `id`, `intent_id`, `from_state`, `to_state`, `cause JSON`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `(intent_id, at)`; `(to_state, at)`                                                                          |
| `cards`            | `id`, `intent_id`, `version`, `terms_hash`, `opened_at`, `expires_at`, `closed_at`, `close_reason`, `place JSON` (where the version's buy or sell trades), `auto_ask` (why auto mode opened the version, an auto test code)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | unique `(intent_id, version)`                                                                                |
| `card_messages`    | `card_id`, `surface` (`telegram`, `console`, `mini`), `chat_id`, `topic_id`, `message_id`, `sent_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PK `(card_id, surface, message_id)`                                                                          |
| `confirmations`    | `id`, `intent_id`, `card_id`, `card_version`, `terms_hash`, `by_surface`, `by_ref`, `at`, `expires_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | unique `intent_id`; a later card version's confirmation replaces the row (decision 0143)                     |
| `carried_outflows` | `intent_id`, `agent_id`, `paper`, `confirmed_at`, `value_usd_micros`, `carried_at`: an outflow the rolling 24-hour cap counted in the state a restore replaced ([decision 0162](../DECISIONS.md#d0162))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | key `intent_id`; `(agent_id, paper, confirmed_at)`                                                           |
| `late_landings`    | `intent_id`, `tx_id` (the dropped step's transaction a block holds after all), `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | key `intent_id`                                                                                              |
| `txs`              | `id`, `intent_id`, `step`, `chain`, `account`, `nonce`, `state`, `raw`, `hash`, `gas_price`, `relays JSON`, `supersedes`, `replacement` (`speedUp`, `cancel`, set with `supersedes`), `block_number`, `receipt JSON`, `signed_at`, `sent_at`, `included_at`, `final_at`                                                                                                                                                                                                                                                                                                                                                                                                                                 | unique `(account, nonce)` where `state IN ('signed','sent','included','final')`; `hash`; `(intent_id, step)` |
| `executions`       | `id`, `intent_id`, `wallet_id`, `asset_in`, `amount_in`, `fee_amount` (the venue's fee, in `asset_in`), `asset_out`, `amount_out`, `gas_asset`, `gas_amount`, `tx_hash` (null on paper), `value_usd_micros` (`amount_in` then), `fee_usd_micros`, `gas_usd_micros`, `paper`, `at`, `realized_usd_micros` (what it realized at average cost when recorded, below zero for a loss; 0 for a row from before, [decision 0137](../DECISIONS.md#d0137))                                                                                                                                                                                                                                                       | `(wallet_id, at)`                                                                                            |
| `arrivals`         | `id`, `wallet_id`, `asset`, `amount`, `value_usd_micros` (null when no price was known), `tx_hash`, `paper`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `(wallet_id, at)`                                                                                            |
| `departures`       | `id`, `intent_id`, `wallet_id`, `asset`, `amount`, `gas_asset`, `gas_amount`, `tx_hash`, `at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `(wallet_id, at)`; `intent_id`                                                                               |
| `positions`        | `wallet_id`, `asset`, `paper`, `quantity`, `cost_usd_micros`, `realized_usd_micros`, `changed_at`, `version`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PK `(wallet_id, asset, paper)`                                                                               |

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

<a id="section-2-4"></a>

### 2.4 Orders, alerts, webhook rules and schedules

| Table            | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Keys and indexes                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `orders`         | `id`, `agent_id`, `wallet_id`, `kind`, `state` (`awaiting_confirmation`, `active`, `paused` while its agent is frozen, `filled`, `cancelled`, `expired`, `ended`), `request JSON` (with its defaults filled), `trigger_state JSON` (for example a trailing stop's highest price), `fills`, `max_fills`, `expires_at`, `intent_id` (the `autoOrder` intent that carries its card), `card_id` (the card version that confirmed it), `paper` (its agent's mode when it was created, the mode it fills in), `outside_content` (the proposing turn's mark, spec 8 section 4.3), `end_reason` (why an `ended` order ended: `position_closed`, spec 6 section 5), `expiry_noticed_at` (when `notice.orderExpiring` went), `created_at`, `changed_at`, `version` ([decision 0189](../DECISIONS.md#d0189)) | `(state, agent_id)`; `intent_id`; `(wallet_id, paper, state)`                    |
| `order_fills`    | `id`, `order_id`, `intent_id`, `outcome` (`filled`, `skipped`), `reason`, `at`, `notices` (JSON, what the owner hears of the row, written with it; [decision 0197](../DECISIONS.md#d0197)), `announced_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `(order_id, at)`, `(at)` where `notices` is set and `announced_at` is not        |
| `alerts`         | `id`, `agent_id`, `condition JSON`, `kind`, `account` and `asset` (the condition's kind, a wallet alert's account and a price alert's asset), `state` (`active`, `fired`, `deleted`, `ended`), `wake` (start a turn when it fires, spec 1 section 8.4), `fires` (how many times it fired), `outside_content`, `created_by`, `created_at`, `changed_at`, `fired_at` (the last fire), `expires_at`, `last_message_id` (the wake-up its last fire stored), `notice_window_at`, `notices_sent` and `notices_held` (its notice hour: five notices at most, the rest counted and told once, decision 0245)                                                                                                                                                                                              | `(state, agent_id)`; `(state, expires_at)`; `(state, account)`; `(state, asset)` |
| `alert_fires`    | `alert_id`, `fires` (the alert's count after it), `agent_id`, `at`, `outcome` (`woke`, `replaced`, `skipped`, `quiet` for an alert without `wake`), `reason` (`frozen`, `archived`, `budget`, `hourly`, `busy`), `message_id` (the wake-up it stored or replaced); an agent's rows are kept 7 days, its newest 1,000 at most                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | primary key `(alert_id, fires)`; `(agent_id, at)`                                |
| `webhook_rules`  | `id`, `agent_id`, `name`, `secret_hash`, `action JSON`, `state` (`awaiting_confirmation`, `active`, `deleted`), `rate_per_min`, `fills`, `max_fills`, `expires_at`, `card_id`, `created_at`, `changed_at`, `version`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `(state)`                                                                        |
| `webhook_events` | `id`, `rule_id`, `alert_id`, `body_hash`, `received_at`, `outcome` (`accepted`, `repeat`, `rate`, `rejected`), `intent_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `(rule_id, received_at)`; `(rule_id, alert_id)`                                  |
| `schedules`      | `id`, `agent_id`, `when JSON`, `prompt` (at most 2,000 characters), `state` (`active`, `cancelled`, `ended`), `next_at` (set while `active`), `zone` (the IANA zone `next_at` was worked out in, decision 0231), `last_at`, `last_due_at`, `last_outcome`, `last_reason` (the last run, decision 0232), `last_message_id` (its last wake-up), `created_by`, `outside_content`, `created_at`, `changed_at`                                                                                                                                                                                                                                                                                                                                                                                         | `(state, next_at)`; `(agent_id, state)`                                          |
| `schedule_runs`  | `schedule_id`, `due_at`, `at`, `outcome` (`sent`, `skipped`), `reason` (`frozen`, `archived`, `budget`, `waiting`, `busy`), `message_id` (the `inbox/scheduleDue` a sent run stored)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | primary key `(schedule_id, due_at)`; `(at)`                                      |

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

| Table             | Columns                                                                                                                                                                                                                                                                                                        | Keys                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `prices`          | `asset`, `source` (`chainlink`, `quote`, `dexscreener`), `usd_micros`, `at`                                                                                                                                                                                                                                    | PK `(asset, source)`                                                  |
| `risk_cache`      | `asset`, `source` (`goplus`, `honeypot`, `simulation`), `result JSON`, `fetched_at`                                                                                                                                                                                                                            | PK `(asset, source)`                                                  |
| `launches`        | `chain`, `token`, `launchpad`, `creator`, `quote_token`, `tax_bps`, `snipe_tax_bps`, `curve_progress_bps`, `graduated`, `insiders JSON`, `block`, `block_hash`, `tx_hash`, `log_index`, `launched_at`, `changed_at`                                                                                            | PK `(chain, token)`; `(chain, launched_at)`; `(creator, launched_at)` |
| `tracked_wallets` | `account` (CAIP-10), `since_block` (the first block read), `last_block` (the last block read), `overflow_blocks` (blocks whose reads the per-block budget cut), `added_at`, `untracked_at`, `overflow_told_blocks` and `overflow_told_at` (the cut blocks the owner was last told of, and when, decision 0250) | PK `account`                                                          |
| `wallet_activity` | `id`, `account`, `block`, `tx_hash`, `log_index`, `side` (`buy`, `sell`), `asset`, `amount`, `counter_asset`, `counter_amount`, `value_usd_micros`, `share_sold_bps`, `venue`, `at`                                                                                                                            | unique `(account, tx_hash, log_index)`; `(account, at)`               |
| `watch_cursors`   | `watcher` (`launches`, `wallets`), `chain`, `block`, `block_hash`, `at`                                                                                                                                                                                                                                        | PK `(watcher, chain)`                                                 |

- **`launches`** holds one row per token a launchpad created, written by the launch watcher from
  the launchpad plugin's decoded create event, insert-or-ignore on its key, so a block read twice
  records each launch once. `curve_progress_bps` and `graduated` are updated in place as the
  watchers read them; `insiders` holds the wallets the launchpad or the risk step names as exempt
  or first holders. A launch whose block a reorganization removed, and that no block holds once
  that height is final, is deleted.
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
  share of its holding a sale took. `wallet/activity` reads a tracked wallet here, and the
  agent's own wallets from `executions`.
- **`watch_cursors`** holds where each log watcher stopped. After an outage it checks that the
  stored block still has `block_hash`, then reads on from the block after it; when the hash
  differs, it reads again from the chain's last final block.

<a id="section-2-7"></a>

### 2.7 Surfaces, delivery and idempotency

| Table               | Columns                                                                                                                                                                                                                                                                                                                              | Keys and indexes                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `inbox`             | `id`, `source` (`telegram`, `webhook`), `source_key` (`tg:<bot>:<update>`), `payload JSON`, `received_at`, `handled_at`                                                                                                                                                                                                              | unique `source_key`                                      |
| `outbox`            | `id`, `surface`, `target JSON`, `payload JSON`, `state` (`queued`, `sent`, `unknown_after_send`, `failed`), `attempts`, `next_at`, `ref`, `created_at`, `sent_at`                                                                                                                                                                    | `(state, next_at)`                                       |
| `notices`           | `id`, `agent_id`, `kind` (the notice's name), `i18n_key`, `values JSON` (the message's values, times, amounts, parts and the messages that follow it), `level` (`info`, `warning`, `critical`), `at`, `delivered JSON` (each surface's delivery state), `intent_id` (the intent it is about, [decision 0133](../DECISIONS.md#d0133)) | `(at)`                                                   |
| `idempotency`       | `credential`, `op`, `key`, `args_hash`, `result JSON`, `at`                                                                                                                                                                                                                                                                          | PK `(credential, op, key)`                               |
| `agent_inbox`       | `id` (`msg_…`), `agent_id`, `session_id`, `kind` (the `inbox` push kind), `turn_id` (the turn reserved for it), `payload JSON`, `created_at`, `taken_at`                                                                                                                                                                             | `(agent_id, taken_at)`                                   |
| `model_usage`       | `id`, `key` (each attempt's own, `<turn>.usage.<n>`), `agent_id`, `turn_id`, `model`, `input_tokens`, `output_tokens`, `cached_tokens`, `usd_micros`, `at`                                                                                                                                                                           | unique `key`; `(agent_id, at)`                           |
| `budget_notices`    | `agent_id`, `day_at` (the start of the owner's day on which the agent's model budget was spent), `at`                                                                                                                                                                                                                                | PK `(agent_id, day_at)`                                  |
| `questions`         | `id` (`qst_…`), `agent_id`, `session_id`, `turn_id`, `text`, `choices JSON`, `ref` (a random 12-byte base64url reference for its buttons), `state` (`open`, `answered`, `closed`), `answer JSON`, `close_reason` (`replaced`, `cleared`, `expired`), `created_at`, `closes_at`, `closed_at`                                          | unique `ref`; unique `(agent_id)` where `state = 'open'` |
| `question_messages` | `question_id`, `surface` (`telegram`, `console`, `mini`), `chat_id`, `topic_id`, `message_id`, `sent_at`                                                                                                                                                                                                                             | PK `(question_id, surface, chat_id)`                     |
| `telegram_owner`    | `id` (always `1`), `user_id` (the Telegram user the bot answers), `paired_at`, `agent_id` (the agent `/use` picked, [decision 0204](../DECISIONS.md#d0204))                                                                                                                                                                          | PK `id`                                                  |
| `telegram_topics`   | `agent_id`, `chat_id`, `thread_id` (the topic's `message_thread_id`), `created_at` ([decision 0186](../DECISIONS.md#d0186))                                                                                                                                                                                                          | PK `(agent_id, chat_id)`                                 |

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

| Table               | Columns                                                                                                                                                                                                                     | Keys and indexes                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `meta`              | `key`, `value`                                                                                                                                                                                                              | PK `key`                                  |
| `sessions`          | `id`, `agent_id`, `surface`, `conversation` (for example `telegram:<chat>:<topic>`), `started_at`, `cleared_at`, `summary`, `version`                                                                                       | `(agent_id, conversation)`                |
| `turns`             | `id`, `session_id`, `started_at`, `ended_at`, `outcome` (`ok`, `stopped`, `failed`, `budget`, `loop`), `committed`, `outside_content`, `held_back` (propose calls not run, [decision 0167](../DECISIONS.md#d0167)), `model` | `(session_id, started_at)`                |
| `chat_queue`        | `message` (`msg_…`), `agent_id`, `session_id`, `kind`, `payload JSON`, `received_at`, `turn_id` (the turn that took it), `dropped_at`, `drop_reason`                                                                        | PK `message`, `(session_id, received_at)` |
| `transcript_events` | `id`, `session_id`, `turn_id`, `seq`, `role` (`owner`, `agent`, `tool`, `system`), `kind` (`text`, `tool_call`, `tool_result`, `image`, `summary`), `content JSON`, `outside` (outside content, spec 8 section 5.4), `at`   | unique `(session_id, seq)`                |
| `notes`             | `id`, `agent_id`, `text`, `origin` (`owner`, `agent`, `untrusted`, `system`), `created_at`, `changed_at`, `deleted_at`                                                                                                      | `(agent_id)`                              |
| `notes_fts`         | FTS5 over `notes.text`, kept in step by triggers                                                                                                                                                                            |                                           |

`meta` holds the writer fence (`writer_fence`), raised at each runtime start and checked by every
transcript write ([spec 8, section 2.3](runtime.md#section-2-3)). Triggers refuse every change of
a `transcript_events` row, and every removal but the retention job's, which sets
`meta.prune_before` to its cutoff inside its own transaction
([decision 0169](../DECISIONS.md#d0169)). `notes_fts` uses FTS5's trigram tokenizer, so a query of
three characters or more finds a word inside Chinese text. `agent_inbox` in the engine
database holds each message for the runtime until the runtime takes it into `chat_queue`
([spec 8, section 3.2](runtime.md#section-3-2)).

Notes never hold a contract or token address as a source for actions
([rule 10](../ARCHITECTURE.md#rule-10)); the runtime does not pass note text to propose tools as an
address ([decision 0206](../DECISIONS.md#d0206)). A query under three characters finds the notes
whose text holds it.

<a id="section-4"></a>

## 4. Retention

A daily job (inside the engine's schedule queue) prunes:

| What                                                                                                                                           | Kept                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ledger`, `executions`, `arrivals`, `departures`, `positions`, `intents`, `txs`, `cards`, `confirmations`, `late_landings`, `carried_outflows` | forever                                                            |
| `transcript_events`, `turns`, `chat_queue`                                                                                                     | 90 days ([decision 0056](../DECISIONS.md#d0056); `chats.keepDays`) |
| `idempotency`                                                                                                                                  | 24 hours                                                           |
| `mini_app_launches`                                                                                                                            | 24 hours, deleted at each Mini App sign-in                         |
| `mini_app_tickets`                                                                                                                             | 5 minutes, deleted at each new ticket; a sign-in deletes its own   |
| `inbox` handled, `outbox` sent, `agent_inbox` taken                                                                                            | 30 days                                                            |
| `webhook_events`                                                                                                                               | 90 days                                                            |
| `schedule_runs`                                                                                                                                | 90 days                                                            |
| `notices`                                                                                                                                      | 90 days                                                            |
| `launches`, `wallet_activity`                                                                                                                  | 90 days                                                            |
| `tracked_wallets` untracked                                                                                                                    | 90 days after `untracked_at`                                       |
| `questions` and their `question_messages`, once closed or answered                                                                             | 30 days                                                            |
| `model_usage`, `budget_notices`                                                                                                                | 400 days                                                           |
| `prices`, `risk_cache`, `watch_cursors`                                                                                                        | replaced in place                                                  |
| `jobs` ended                                                                                                                                   | 30 days                                                            |

<a id="section-5"></a>

## 5. Integrity checks

`binference check` runs, per database: `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, the
ledger chain walk, the unique-nonce index check, and a comparison of `schema_version` with the
binary's expected version. `check --fix` runs `VACUUM` and `ANALYZE` after a backup when free pages
exceed 20%.
