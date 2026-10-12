# 0185. An agent mutes notices by kind, and never a security notice

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Decision 0057](../DECISIONS.md#d0057) and [ARCHITECTURE.md section 27](../ARCHITECTURE.md#section-27)
send every fill, every failed or skipped fill, low gas, orders about to expire, security events and
a daily summary at 09:00, each "configurable per agent". The owner added the alert, exit order and
update notices to the set on 2026-10-12 ([spec 4, section 4](../specs/cards-and-messages.md#section-4)).
`defaults.notifications` ([spec 2](../specs/config.md#section-6-4)) holds the set for a new agent,
and `agents.notifications` stores each agent's choices, but neither says their shape, which kinds
a choice may turn off, or what happens to a notice that names no agent. Until now every notice was
delivered ([decision 0133](../DECISIONS.md#d0133)).

Several notices exist to catch someone else: "Not you? Freeze now." after a ceiling change, a
rescue address that changes in 24 hours, a new console device, sign-ins locked. A notice the owner
muted cannot do that. A setting changed with a stolen admin token, or by mistake, would hide the
one message that tells the owner.

## Decision

- **What can be muted.** An agent may mute `fill`, `skipped`, `lowGas`, `orderExpiring`, `daily`,
  `alertPrice`, `alertWallet`, `alertLaunch`, `ordersEnded`, `exitEnded`, `update`, `updateBare`,
  `updated` and `updatedBare`: decision 0057's configurable kinds and those the owner added. Every
  other kind always goes: security events, a trade or money that needs a look (a fill that differs,
  a step that stopped part way, a rollback), and the engine or the agent stopping (locked, signer
  stopped, the loop guard, a spent budget).
- **Settings.** `agents.notifications` is `{ muted, dailySummaryTime }`: the muted kinds, each once,
  and the daily summary's time, `HH:mm` in the owner's timezone. A stored document missing a field,
  or from before the settings, reads as nothing muted and 09:00, and a kind that cannot be muted is
  dropped as it is read. `defaults.notifications.muted` (default `[]`) and
  `defaults.notifications.dailySummaryTime` (default `"09:00"`) are copied into each new agent; a
  config that mutes a kind outside the list is refused. Adding the key is config migration 5 to 6.
- **Muting.** A notice is muted when its kind may be muted and the agent it names muted it. A
  notice that names no agent, such as an update notice, is muted only when every agent that is not
  archived muted its kind. A muted notice is stored as every notice is, with no outbox row and an
  empty `delivered`, so `notice/list` still shows it and no surface sends it. When the settings
  cannot be read, the notice goes.
- **Operations.** `notice/getSettings` (`read`) answers `{ muted, mutable, dailySummaryTime }`.
  `notice/setSettings` (`admin`, a write) replaces the muted kinds, moves the summary, or both; a
  kind that cannot be muted, a kind named twice or a bad time is `protocol.bad_args`. Each change is
  journaled under `agents.<name>.notifications` and pushed as `config/changed`.
- **Parts.** A notice may carry `parts`, messages its message takes as arguments, each a key with
  its own values, times, amounts and parts, two levels deep at most, and `after`, at most four
  messages shown on lines of their own after it. A surface writes them in the owner's language with
  the notice. `{orderKind}` is the new `order.kind` message, and `{result}`, `{reason}`, `{launch}`
  and `alert.woke` come in as parts, as spec 4 section 4.3 words them.

## Consequences

- Mutes reach new agents through the config, and existing agents through `notice/setSettings`; the
  console's settings screen and the CLI call it.
- A muted kind sends nothing on Telegram, and the surfaces that come later read the same record.
- Spec 1 gains `notice/getSettings`, `notice/setSettings`, and `parts` and `after` in `notice/new`
  and `notice/list`; spec 2 replaces `defaults.notifications` with its two keys; spec 3 writes the
  shape of `agents.notifications`; spec 4 gains the muting rule and `order.kind`.
- Quiet hours stay out, as decision 0057 says.

## Alternatives

- **Every kind can be muted.** Decision 0057's words allow it, but one changed setting would then
  hide the warning that a ceiling or a rescue address is changing. Rejected.
- **A list of kinds that are on.** A kind added later would be off for every agent until the owner
  turned it on. Rejected: the muted list keeps new kinds on.
- **Drop a muted notice.** The console could not show what was muted, and a mistake could not be
  read back. Rejected.
- **Format the arguments in the engine.** The outbox writes a notice when it goes, in the owner's
  language then; text written at publish time would keep the old language. Rejected.
