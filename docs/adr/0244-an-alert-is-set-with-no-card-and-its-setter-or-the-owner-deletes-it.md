# 0244. An alert is set with no card, and its setter or the owner deletes it

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Spec 1](../specs/protocol.md) section 7.5 gives `alert/create`, `alert/list` and `alert/delete`
the `propose` and `read` scopes, and section 8.4 their conditions, the 50-alert cap, the 50-wallet
cap and the default ends. An alert sends no transaction and opens no card. The specs leave open:

- **Who may delete which alert.** An MCP client also holds `propose`.
- **Whether an alert is marked** when an outside client or a marked turn sets it, as orders and
  schedules are ([decision 0233](0233-the-owner-and-the-agent-set-schedules-with-no-card-journaled-and-announced.md)).
- **Which conditions are refused,** and what `alert/list` answers without a state.
- **How the wallet cap counts** before the leader watcher keeps `tracked_wallets`.
- **Whether a set alert is journaled and announced,** as a schedule is.

## Decision

- **No card, no journal.** `alert/create` stores an active alert at once, for every surface and the
  agent runtime alike. Setting one is not announced: each fire tells the owner (spec 4, section
  4.3), so no alert acts unseen, and an alert changes no setting.
- **The mark.** An alert set by a client with `propose` alone, or in a turn that read outside
  content, is stored with `outside_content`, as orders and schedules are.
- **Refusals,** each `protocol.bad_args` and storing nothing: an asset on no chain of the registry;
  an account whose chain family cannot read its address; a price or least dollar value of zero; a
  launch filter naming a launchpad this engine does not run, or a quote token on no chain of the
  registry; an `expiresAt` not ahead. An unknown or archived agent is `agent.not_found` or
  `agent.archived`; a frozen agent may still set one, as with schedules.
- **Defaults.** `wake` is off. A wallet or launch alert ends 30 days on; a price alert never.
- **Delete.** The owner's surfaces and the agent runtime delete any alert; a client with `propose`
  alone, only the alerts it set (`auth.scope`), as with orders and schedules. An alert that is not
  active is `alert.not_found`.
- **List.** `alert/list` pages oldest first, in every state unless one is named, of one agent or
  all, as `order/list` does.
- **The wallet cap.** Until the leader watcher keeps `tracked_wallets`, the store counts the
  distinct accounts of the install's active wallet alerts, in the write that stores the alert; an
  account already tracked passes.
- **Storage.** Migration 0041 makes `alerts` again with the condition's kind and account, `wake`,
  `fires`, `outside_content`, `created_by`, `changed_at`, `expires_at`, `last_message_id` and the
  `ended` state.

## Consequences

- The agent's `alert_create` control tool maps to `alert/create` as it is.
- The leader watcher's task must count copy order leaders, those awaiting their card too, beside
  the wallet alerts' accounts, and add or clear `tracked_wallets` rows in the same writes.
- Spec 1 section 7.5 and spec 3 section 2.4 say so.

## Alternatives

- **A card for an alert with `wake`.** Each wake-up runs a turn that proposes through its own cards,
  and the hourly limit bounds it. Rejected: a tap for no money.
- **Journal and announce each alert,** as schedules are. Rejected: every fire already reaches the
  owner, and the notice of setting one would double the noise of an agent that watches many.
- **Let any `propose` client delete any alert.** Rejected: an outside client could silence the
  owner's own alerts.
