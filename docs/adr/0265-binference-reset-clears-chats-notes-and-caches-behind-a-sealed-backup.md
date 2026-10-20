# 0265. binference reset clears chats, notes and caches behind a sealed backup

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

ARCHITECTURE.md section 24 lists `binference reset`, and no spec says what it clears. The database
spec keeps money records forever: the ledger, intents, transactions, executions, arrivals,
departures and positions, and the rolling 24-hour cap counts confirmed outflows from them, so
clearing any would loosen a limit (decision 0163 lets no restore loosen one). The wallets are read
through the custody link in `engine.sqlite` and the keys at rest; the owner key's public half is in
the custody row. The agent's chats and notes live in `agent.sqlite`, whose transcript triggers
refuse every removal outside a task that opens them (decision 0169); the messages waiting for the
agent and its questions live in `engine.sqlite`, with each agent's open chat session. A live
intent in `executing` may have a transaction on its way.

## Decision

- `binference reset` clears, in one transaction of each database: every chat (sessions, turns,
  transcript events, queued messages) and note in `agent.sqlite`; the agent inbox, the agents'
  questions and their copies on the surfaces, and the token risk cache in `engine.sqlite`. Each
  agent's open chat session is let go, so its next message opens a new one. The agent database's
  writer fence is raised first.
- Everything else stays: wallets, the custody link, the keys, the config, limits, send levels,
  saved addresses, auto orders, alerts, schedules, the workspace files, notices, model spend and
  every money record. The wallets read as before the reset.
- It runs with the engine stopped, as `binference backup restore` does: it stops the engine as
  `binference stop` does, works under the engine lock, then starts the engine again as it ran, with
  this run's `--set` flags.
- It refuses while a live intent is `executing`: the running engine is asked first, and
  `engine.sqlite` is read again under the lock.
- First it takes a `manual` backup sealed to the owner key, checked as every backup is. Nothing is
  cleared unless it succeeds, its copy to `backups.copyTo` included.
- It records the reset in the config journal at the path `state.reset`, with the backup's id and
  the rows cleared, and writes `state.reset` to the engine log.
- At a terminal the owner types a phrase in their language (`reset`, or its Chinese word); with
  nobody at the terminal, or with `--json`, it goes on only with `--yes`.

## Consequences

- An owner can start the agent's memory over without touching money, limits or custody, and the
  backup brings the old chats back through `binference backup restore`.
- `binference backup restore` and reset share the steps that stop and start the engine.
- Two store tasks, one per database, hold the clearing.

## Alternatives

- **Clear the money records too.** It would loosen the 24-hour cap and lose the tax history.
  Rejected.
- **Clear with the engine running.** The runtime holds `agent.sqlite` and could write between the
  backup and the clearing. Rejected.
- **Cancel the auto orders, or reset the workspace files.** They are the owner's standing choices,
  not chat state; whether a reset should touch them is left to the owner.
