# 0142. A new machine receives the install from a sealed backup

Status: Proposed

## Context

`binference init --attach` moves every wallet's signer to a new machine
([decision 0140](../DECISIONS.md#d0140)). It needs the install's state on that machine:
`engine.sqlite` (the custody's quorum ids, the wallets with their Privy ids and ceilings, the rescue
address and a change that waits, agents, limits, send levels, approval modes, the address book,
the Telegram owner binding, intents, the ledger and positions), `agent.sqlite`, `workspace/` and
`config.json5`. Spec 5, section 6 says a backup brings back orders, history and settings, and
section 7.4 names `binference init --attach --restore <file>`, but backups are not built yet. Today
attach runs only on a folder that holds the install: a machine whose agent key was lost, or a
state folder brought over by hand. A lost machine with no backup leaves nothing to attach to,
though its wallets, ceilings and funds are all still on Privy.

## Decision

Proposed, for the owner to choose:

- **Main path:** `binference init --attach --restore <file>` restores a sealed backup (spec 5,
  section 7), which the owner key opens with the same code attach asks for, then attaches. Backups
  are built first, with their daily schedule and `backups.copyTo`, so a copy outlives the machine.
- **Planned move, until backups exist:** the owner runs `binference stop` on the old machine and
  copies its state folder without `keys/` to the new one, then runs `binference init --attach`
  there. The docs say so; the database is never copied while an engine runs.
- **Lost machine with no backup:** `binference init --attach` on an empty folder rebuilds what
  Privy holds: the wallets the owner key's quorum owns, each ceiling's mirror, one agent for all of
  them, the default limits, and the rescue address the owner types, which must be in every
  ceiling. History, settings, labels and the bot's pairing are lost, and attach says so before it
  changes anything.

## Consequences

- Backups become a dependency of attach on a new machine; the empty-folder rebuild is a fallback
  of its own, with its own tests.
- Until one is chosen, attach on a folder with no install stops with `init.attach_needs_install`.

## Alternatives

- **Only backups.** A machine lost before its first backup could never be attached; the owner would
  start over with a new owner key and move funds through the rescue address. Kept as the default
  if the rebuild is not wanted.
- **Only the rebuild from Privy.** Every move would lose history and settings, and the policy cannot
  tell the rescue address from a saved address, so the owner types it again. Rejected as the main
  path.
- **Sync the state to a server.** binference keeps no copy of a self-hosted owner's state off their
  machines. Rejected.
