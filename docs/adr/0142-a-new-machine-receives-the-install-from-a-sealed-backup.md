# 0142. A new machine receives the install from a sealed backup

Status: Accepted

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

- **Main path, once backups exist:** `binference init --attach --restore <file>` restores a sealed
  backup (spec 5, section 7), which the owner key opens with the same code attach asks for, then
  attaches. It replaces the planned move below.
- **Planned move, until then:** the owner runs `binference stop` on the old machine and copies its
  state folder without `keys/` to the new one, then runs `binference init --attach` there. Attach
  checks that the copy is of a stopped engine: `engine.sqlite-wal` and `engine.sqlite-shm` are
  gone once an engine closes its database, so either one there stops attach. It checks that
  `keys/agent-key` is absent or holds a key an earlier attach on this machine left. The key the
  wallets name now there means a copy of the old `keys/`, or a machine attached already, and the
  refusal names both: delete the copied `keys/`, or nothing needs attaching. A secret source of `config.json5` that names a file in another state
  folder's `keys/` moves to this folder's `keys/`, and attach asks for that secret.
- **Lost machine with no backup:** `binference init --attach` on an empty folder rebuilds what
  Privy holds: the wallets the app holds whose owner is the owner key, found with Privy's
  `authorization_key` filter, each ceiling's mirror, one agent with the default settings, and the
  rescue address when it is readable: the one address every ceiling's sends allow in common.
  Otherwise the owner names one of the addresses the ceilings allow. History, settings, labels,
  the address book and the bot's pairing start fresh. Attach shows this warning first and goes on
  only once the owner types the number of wallets it found.

## Consequences

- Backups become a dependency of attach on a new machine; the empty-folder rebuild is a fallback
  of its own, with its own tests.
- A folder with a config file but no install, or an install but no config file, still stops
  attach: neither a planned move nor a lost machine leaves one.

## Alternatives

- **Only backups.** A machine lost before its first backup could never be attached; the owner would
  start over with a new owner key and move funds through the rescue address. Rejected.
- **Only the rebuild from Privy.** Every move would lose history and settings, and the policy cannot
  tell the rescue address from a saved address, so the owner types it again. Rejected as the main
  path.
- **Sync the state to a server.** binference keeps no copy of a self-hosted owner's state off their
  machines. Rejected.
