# 0152. A running install restores a backup from the CLI, between a stop and a start

Status: Proposed

## Context

[Spec 5, section 7.4](../specs/keys-and-backups.md#section-7-4) names two ways to restore a
backup: `binference init --attach --restore <file>` on a new machine, and
`binference backup restore <file>` over IPC on a machine whose engine runs. Both ask for the owner
key, open the backup's data key with it, decrypt and check every file, refuse a newer schema, stop
the engine, move the current state aside for 7 days, put the restored files in place, start the
engine and check the manifest's wallets against Privy.

The first is built: it runs with no engine, under the engine lock. The second meets three gaps:

- Protocol v1's `backup/restore` takes `{ backup }`, the id of a listed backup, and answers a job
  after which "the engine restarts". It carries no owner key, and v1 takes additions only.
- The owner key code travels only over IPC, for one request
  ([decision 0131](../DECISIONS.md#d0131) keeps a wallet's key out of the engine by opening it
  in the CLI). An engine that opened the backup would hold the code for the whole restore.
- The engine holds `engine.sqlite` open, and Windows does not rename an open file, so the engine
  must stop before the swap. Nothing in the engine can start it again: the background service
  does, through the platform's `ServiceManager`, or a person does in the foreground.

## Decision

- `binference backup restore <file>` runs the restore in the CLI process, as
  `init --attach --restore` does: the hidden prompt takes the owner key, which opens the data key
  before any chunk is read; the backup is unpacked and checked into a folder of the state folder;
  a newer schema is refused; the manifest's wallets are checked against Privy with the app secret
  `config.json5` names, before anything changes. A refusal changes nothing, and the engine runs on.
- The backup must hold this machine's agent key as its signer. A backup whose custody names
  another agent key is refused with a pointer to `binference init --attach --restore`.
- Then the CLI stops the engine over IPC with `engine/stop`, the shutdown `binference stop` runs,
  waits for the engine lock, moves the state aside to `replaced/<time>/` (kept 7 days), puts the
  restored files in place, and starts the engine as it ran: the service through
  `ServiceManager`, or, after a foreground start, it tells the person to start it.
- `backup/restore` stays unserved in v1, as `wallet/exportKey` does. A later protocol version may
  add an owner-key route for a listed backup.

## Consequences

- The owner key code never reaches the engine; one restore path, shared with attach, checks and
  swaps the files.
- The engine is down from the stop until the start; startup runs migrations and reconciliation as
  after any restart.
- The command is IPC-only in effect: it needs the state folder, so the console and Telegram
  cannot run it.

## Alternatives

- **Serve `backup/restore` in the engine with the owner key in its args.** The engine would hold
  the code through a long job and replace the database it holds open, then restart itself, which
  it has no means to do. Rejected.
- **Only `init --attach --restore`.** The owner would stop the engine, restore and attach on the
  same machine, which moves every wallet's signer for no reason. Rejected.
