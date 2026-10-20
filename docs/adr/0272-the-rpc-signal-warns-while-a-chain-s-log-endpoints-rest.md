# 0272. The rpc signal warns while a chain's log endpoints rest

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

The `rpc` health signal of `engine/status` read only the failover of a chain's reads: failed
while every endpoint of a chain rests after a failure, a warning while some do. Log queries go
through a failover of their own
([decision 0252](0252-log-queries-go-to-48-club-s-public-node-until-the-owner-names-an-rpc.md)):
48 Club's public node on BSC until config names an RPC. The leader watcher and the launch feed
send their `eth_getLogs` there, so wallet alerts, copy orders and new launches depend on it.
When only the log node was down, rate limited or gone, the signal read `ok`: quotes and sends
worked, the watchers read nothing, and only a `watcher.*_read_failed` log line said so.

## Decision

- A chain's part of the `rpc` signal is its reads' state, and at least `warn` while some or all
  of its log endpoints rest after a failure. It is `fail` only when every endpoint of its reads
  rests, as before, since quotes, wallet facts and sends then fail too.
- No new signal and no new words: `status` shows "Chain RPC nodes: needs a look", and the log
  line names the read that failed.

## Consequences

- An owner whose log node stops sees a warning in `binference status` within one failed read,
  and naming an RPC under `chains.rpc.<chain>.urls` clears it, as decision 0252 says.
- A log endpoint rests 30 seconds after a failure, so the warning clears 30 seconds after its
  last failure, as the reads' endpoints do.
- Decision 0252's last consequence gains a visible outcome: the watcher's log line and the
  `rpc` warning.

## Alternatives

- **A separate `log_rpc` signal.** One more signal name in the protocol, the glossary and both
  languages, for a part that shares the chain's RPC settings. Rejected.
- **`fail` while the log endpoints rest.** It would say the chain cannot be read while quotes
  and sends work. Rejected.
- **Leave the signal to the reads' failover.** The owner would see `ok` while copy orders and
  wallet alerts read nothing. Rejected.
