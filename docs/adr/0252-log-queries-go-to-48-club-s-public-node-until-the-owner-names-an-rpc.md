# 0252. Log queries go to 48 Club's public node until the owner names an RPC

Status: Amended by 0272

Accepted by the owner on 2026-10-19.

## Context

The leader watcher reads the tracked wallets' transfers with `eth_getLogs`
([decision 0249](0249-the-leader-watcher-reads-a-tracked-wallet-s-trade-once-per-transaction.md)).
BNB Chain's docs list the public BSC RPCs the registry holds and say `eth_getLogs` is disabled on
them, pointing log readers to the third-party endpoints Chainlist lists; they answer -32005
"limit exceeded". Without an RPC of the owner's, the watcher would read nothing. The facts about
48 Club's public node, `https://rpc-bsc.48.club`, which Chainlist lists for BSC:

- 48 Club's docs document its privacy RPC, `https://rpc.48.club`, and an HTTP 429 with an
  `X-Ratelimit-Remaining` header past its rate limit; they do not list the public node itself.
  Their terms of use read IP addresses for rate limiting only, and let 48 Club suspend a service
  at any time.
- Measured on 2026-10-19 from one machine: the node answers `eth_getLogs` with a `Transfer` topic
  and 50 addresses in a topic position in about 0.1 s for one block, 0.2 s for 10 blocks, 7.7 s
  for 1,000 and 18 s for 5,000, with no range refused; by block hash in 0.1 s; logs 200,000
  blocks back as well. Its headers allow 80 requests in 5 seconds and 720 a minute. It refuses
  state reads at older blocks ("not supported").
- At the head, the watcher asks two log queries a block: about 264 a minute on BNB Smart Chain.

## Decision

- **The owner's choice.** Log queries go to 48 Club's public node by default, through a failover
  of their own, apart from the chain's other reads, which stay on its public RPCs.
- **The registry holds it.** A chain definition may list `logRpcs`, public RPCs that answer
  `eth_getLogs`; BSC lists 48 Club's public node. A chain without them asks its public RPCs.
- **The owner's RPC always wins.** Once config names RPCs under `chains.rpc.<chain>.urls`, log
  queries go to those alone, as the chain's other reads go to them first; the default is never
  asked then. The list follows config as it reloads, as the chain's RPCs do
  ([decision 0230](0230-a-setting-applies-at-its-part-s-next-use-and-a-looser-fee-cap-after-a-restart.md)).
- **Past its limit** the node answers 429; the failover rests it, the read fails, and the watcher
  reads the same block again a block time later
  ([decision 0250](0250-the-leader-watcher-reads-every-block-once-within-a-budget-and-resumes-where-it-stopped.md)).

## Consequences

- `ChainDefinition` gains the optional `logRpcs`; the self-hosted chain reads gain `logsRpc`. No
  config key is new.
- An install with no RPC of its own sends 48 Club its IP address and its tracked wallets'
  addresses with each log query. A keyed provider keeps them off 48 Club's node.
- If 48 Club stops the node, the watcher logs `watcher.leader_read_failed` until the owner names
  an RPC.

## Alternatives

- **Read nothing until the owner names an RPC.** Wallet alerts and copy orders would wait on a
  setting most owners never make. Rejected by the owner.
- **48 Club's privacy RPC for reads.** It is meant for sends, which the registry already relays
  to it. Rejected.
- **A config key for the log RPC.** One more setting for a default the registry can hold, and an
  owner's RPC under `urls` already serves logs. Rejected.
