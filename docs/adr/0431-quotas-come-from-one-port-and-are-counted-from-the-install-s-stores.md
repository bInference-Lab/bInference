# 0431. Quotas come from one port and are counted from the install's stores

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

bInference Cloud runs every user's install on shared workers, one install per user, each in its
own pair of schemas ([spec 3, section 6.2](../specs/database.md#section-6-2)). On 2026-11-05 the
owner set the beta's starting quotas: 3 agents per user, 1 of them live, self-hosted's limits per
agent, and 100 invited users. Self-hosted must refuse nothing it allows today.

Some caps hold on both profiles already, each counted in the store write that adds one: 50 active
alerts (`alert.too_many`), 50 active schedules (`schedule.too_many`) and 20 webhook rules
(`webhook.too_many`) per agent, and 64 installed plugins per install (`plugin.too_many`). The
runtime's settings carry at most 4 listed MCP servers per agent
([decision 0428](0428-the-cloud-agent-calls-listed-mcp-servers-as-read-tools-that-mark-every-turn.md)).
Nothing caps an install's agents, its live agents, an agent's open auto orders, the plugins turned
on, or how fast an agent proposes or takes turns. The agent proposes at most once a turn
([decision 0167](0167-one-turn-sends-at-most-one-proposal.md)), and one turn of an agent runs at a
time.

On SQLite one writer runs every write. On Postgres every write runs serializable and reruns on a
conflict ([decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md)).
One engine and one runtime serve an install, on Cloud under its lease
([decision 0418](0418-an-install-keeps-a-lease-row-of-its-own-beside-its-agents-rows.md)).

## Decision

- **The port.** `QuotaSource` of `@binference/engine`, a profile part: `read(call)` answers the
  install's `Quotas` now. Each field is a whole number of at least 0, absent where no quota holds:
  `agents`, `liveAgents`, `openOrders`, `enabledPlugins`, `listedMcpServers`,
  `proposalsPerMinute` and `turnsPerMinute`. The self-hosted adapter answers none of them. The
  Cloud adapter reads the user's numbers and lives outside this repository;
  `@binference/engine/testing` holds an in-memory fake, and the Cloud test root passes it with the
  Cloud's numbers. A read that fails is a fault of the call, which stores nothing.
- **No number, no count.** A quota the port answers no number for is not counted: the call runs no
  count query for it, so self-hosted pays nothing for quotas.
- **Who reads it.** The engine, at each operation that adds what a quota counts; the composition
  root's plugin operations, at `plugin/add` and `plugin/enable`; and on Cloud the services outside
  this repository that add the same things: the onboarding that makes an agent, the console's
  switch of a listed MCP server, and going live on binference.io. The runtime never reads it.
- **The numbers.**

  | Quota                | Counts                                                       | Self-hosted | Cloud | Why the Cloud number                                                                                                                                       |
  | -------------------- | ------------------------------------------------------------ | ----------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `agents`             | The install's agents not archived                            | None        | 3     | The owner's                                                                                                                                                |
  | `liveAgents`         | The install's live agents not archived                       | None        | 1     | The owner's                                                                                                                                                |
  | `openOrders`         | An agent's orders awaiting their card, active or paused      | None        | 50    | An agent's live facts list at most 50 active and paused orders, so each order it holds reaches its model; alerts and schedules stop at 50 too              |
  | `enabledPlugins`     | The install's plugins turned on                              | None        | 4     | Each runs as its own sandboxed process of up to 512 MiB on the shared worker and offers its tools to every model call of every agent of the user           |
  | `listedMcpServers`   | The listed MCP servers on for an agent                       | None        | 4     | The runtime's settings take 4 per agent (decision 0428)                                                                                                    |
  | `proposalsPerMinute` | An agent's proposals in the last 60 seconds                  | None        | 6     | Each opens a card the owner reads, and quotes every venue, checks risk and simulates on the shared RPC pool before it; no one answers a card in under 10 s |
  | `turnsPerMinute`     | An agent's turns and helper runs that called a model in 60 s | None        | 10    | Messages typed during a turn join it, so an owner's chat stays below 10; a loop of short turns reaches it                                                  |

  Self-hosted's caps above stay on both profiles, as constants of the writes that count them,
  since the Cloud's limits per agent are self-hosted's. The 100 invited users are the Cloud's
  sign-up list, not a quota of this port.

- **Counts of what an install holds are counted in the write that adds one.** `AgentStore.create`
  counts the agents not archived, `AgentStore.setMode` the other live agents not archived when it
  switches one live, `OrderStore.create` the agent's open orders, and the plugin lock's change the
  plugins turned on when it turns one on, each in the same write before it adds. The caller hands
  the write its quota; the store holds no number of its own. SQLite runs one write at a time; on
  Postgres two writes that read the same count conflict, and the one that reruns reads the other's
  row; the plugin lock takes one change at a time. No race passes two.
- **Rates are counted from what is stored, when the call starts.** A proposal reads the agent's
  intents stored in the last 60 seconds, fills, rescues, unfreezes and revokes aside, before it
  reads a chain or stores anything. `turn/start` reads the agent's model usage records of the last
  60 seconds, which a chat deletion keeps, and counts each turn and each helper run once, however
  many model calls it made. Both refusals carry `details.resumesAt`, when enough of the counted
  ones are older than 60 seconds for one more to fit. A rate is read, not written in the adding
  write: two proposals of one agent in flight at once can pass one more in that minute. It bounds
  how fast an agent works, not what it holds. One runtime starts one turn of an agent at a time, so
  no turn passes twice.
- **The order of the checks.** A call whose idempotency key answered before gets its first answer,
  never a quota refusal: the protocol server answers a replay before the handler runs, so the
  quota is read after that lookup. In the handler, the scopes, the args and an unknown, archived or
  frozen agent come first, so a frozen agent still gets `agent.frozen`. The quota comes next,
  before any read of a chain and before anything is stored.
- **The refusals,** each before anything is stored:

  | Code                | Retryable | Refused at                                                                                              |
  | ------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
  | `quota.agents`      | No        | Every write that makes an agent                                                                         |
  | `quota.live_agents` | No        | `agent/goLive`, and going live on binference.io                                                         |
  | `quota.orders`      | No        | `order/create`                                                                                          |
  | `quota.plugins`     | No        | `plugin/add` of a new plugin that would start on, and `plugin/enable`                                   |
  | `quota.listed_mcp`  | No        | The operation that turns a listed MCP server on for an agent, which comes with the Cloud surfaces' spec |
  | `quota.proposals`   | Yes       | `intent/propose`, `order/create`, `webhookRule/create`, `config/propose` and `identity/register`        |
  | `quota.turns`       | Yes       | `turn/start`; the runtime waits until `details.resumesAt` and keeps every message                       |

- **A quota never loosens.** It only refuses. Every cap of the stores, the policy and the limits
  holds beside it, whatever number the port answers.
- **A quota never brakes.** It never refuses a freeze, a rescue, an unfreeze, a cancel, a delete,
  a disable, a removal, a switch to paper, a revoke, or a fill of a confirmed order or rule.
- **A lower quota keeps what exists.** Only new work is refused; nothing held is ended.

## Consequences

- Self-hosted refuses nothing new, and its tests pass unchanged.
- `AgentStore.create`, `AgentStore.setMode` and `OrderStore.create` take an optional quota, and
  the intent store and the model usage gain a count of the last 60 seconds. Their contract suites,
  fakes, SQLite and Postgres adapters change together. No migration: every count reads columns and
  indexes that exist. The agent's intents of the last minute are read through
  `(agent_id, state)`, which an agent with many fills reads more of.
- `agent/create` is not built. Until it is, `binference init` makes the first agent with no quota,
  and the Cloud's onboarding makes agents through the same write with its quota.
- Going live on Cloud happens on binference.io, whose service writes the mode through
  `AgentStore.setMode` with the same quota.
- The runtime maps `quota.turns` to a wait, as it does a spent budget, but drops no wake-up, and
  shows the status line `turn.quota`.
- `quota.listed_mcp` joins the protocol's codes with the operation that sends it; until then the
  runtime's settings bound holds the number.
- A turn whose model calls all fail before a usage record is stored counts nothing toward
  `turnsPerMinute`. The runtime's own backoff after a model error bounds how fast such turns
  repeat.

## Alternatives

- **Move the per-agent caps into the port.** The Cloud's limits per agent are self-hosted's, so a
  second copy of each number would only drift.
- **Check each count before its write.** Two calls that read the same count would both pass.
- **Count rates in the engine's memory.** A restart or a move to another worker would empty the
  count; the stored rows outlast both.
- **Count proposals inside the intent's write.** An auto order and a webhook rule store their record
  before their intent, so a refusal there would come after the record was stored.
- **Count plugins installed, not turned on.** A plugin that is off runs no process and offers no
  tool; the 64 installed stay the cap on files.
- **Rates per user.** Each agent works in its own line, and 3 agents bound a user's rates at three
  times an agent's.
- **Quotas as config keys.** A Cloud user could change them.
