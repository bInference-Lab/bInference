# 0230. A setting applies at its part's next use and a looser fee cap after a restart

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

[Decision 0118](0118-settings-reload-when-config-json5-changes.md) reloads `config.json5` when it
changes and says a key applies at once only when the part that uses it reads it from the config
cell on each use; every other key waits for a restart, and `notice.configChanged` says which.
[Spec 2](../specs/config.md#section-6) marks most keys `live`, but until now only `owner.locale`,
`owner.timezone`, `logging.level`, `telegram.topicsPerAgent` and the backup keys were read on use.
The list of those keys sat in one file and every other key was judged by its absence.

Some live keys reach the money path: the RPC URLs, the private relays, the network fee cap and the
venue keys. A change must never reach a signature or a send under way. Three facts bound the
choice:

- The signer checks each transaction against the network fee cap it started with
  ([decision 0143](0143-no-fee-above-the-cap-is-signed-until-a-card-shows-it.md)); the engine
  writes the signer's settings once, when the signer starts.
- The drop rule ([decision 0115](0115-a-stuck-step-every-relay-refuses-is-dropped-and-ends.md))
  reads a step's last send by the number of relays its chain's sender has.
- The venues declare their contracts when the engine starts, and a wallet's ceiling names the
  contracts of the venues installed when it was made
  ([decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md)).

Some keys spec 2 marks live cannot apply without a restart: `engine.shutdownBudgetMs` also sets
the service manager's wait for the engine's exit, written when `binference start` installs the
service, and `defaults` sets the paper balances and new wallets' ceilings, read at start. Others
have no part that reads them yet.

## Decision

- **One table.** `packages/cli/src/config/apply-times.ts` gives every key of the config's schema
  an apply time: the restart-only keys in one list, the keys read on each use in another, and the
  keys bound by the start with their rule. A key no entry covers waits for a restart, and a test
  fails when a key of the schema has no entry. The reload and `config/change` judge each changed
  key by it, so `notice.configChanged` and `restartNeeded` name a key as applied only when its part
  reads the new value.
- **Read on use.** A part that uses a live key reads it from the config cell at each use. A key
  whose value comes from a secret source (a model provider's key, a search key, the OKX key) is
  read again at the reload, once, before the notice, and the part holds what was read; one that
  cannot be read is logged with its code and left out, as at start. The runtime gets its whole
  `settings` line again when a key it uses changed (runtime spec, section 2.2).
- **Money-path keys reach only work that starts after the reload:**
  - RPC URLs: each request goes to the endpoints the config names when it starts. The failover
    already moves to another endpoint between any two requests, so a reload adds no new case; a
    request under way finishes where it started.
  - Relays and the fee cap: the executor takes a chain's sending parts (the relay sender and the
    transaction preparer with its fee cap) once per intent run, when the run starts. A reload
    builds new parts for a chain whose relays or fee cap changed; an intent under way keeps the
    parts it started with to its end, so its sends, its replacements and its drop rule count one
    set of relays.
  - The fee cap: a lower cap applies to the next intent run and to the next wallet facts read,
    which the card's fee check and an auto grant use. A cap above the one the engine started with waits
    for a restart, because the signer still holds the cap it started with; until then the engine
    uses the cap it started with. The notice names the raise as waiting for a restart.
  - The OKX key: each request signs with the key held when the request starts. A plan is built
    before its card, and the signer signs only steps under the terms hash the owner confirmed
    ([decision 0144](0144-the-terms-hash-covers-the-plan-and-a-re-quote-hashes-again.md)), so a
    key that changes between a quote and a build cannot change what is signed. Removing the key
    applies at once: OKX then answers no quote. Adding a key to an engine that started without
    one waits for a restart, since the venue and its contracts are listed at start.
  - The KyberSwap client id: each request names the id the config holds when it starts.
- **Restart-only beyond spec 2's list:** `engine.shutdownBudgetMs` and `defaults`, for the
  reasons above.
- **Keys no part reads yet** (`telegram.groups`, `chains.rpc.<chain>.key`, `venues.keys.oneinch`,
  `venues.keys.zerox`, `remote.mini`, `remote.webhooks`, `updates`, `telemetry`,
  `chats.keepDays`, `plugins`) are judged live: no running part holds an older value, and the part
  that comes for one reads it on each use and adds its row to the table test.

## Consequences

- An owner who lowers the fee cap, rotates a key or changes an RPC sees it in use at once, and an
  intent under way finishes as it started.
- Raising the fee cap past its start value needs `binference restart`, and the notice says so.
- A new config key needs a row in the table before the schema test passes.
- Spec 2 marks `engine.shutdownBudgetMs` restart, says when `chains.maxFeePerGasGwei` and
  `venues.keys.okx` apply, says `defaults` apply after a restart, and names the table.

## Alternatives

- **Send the signer a new fee cap at the reload.** A lower cap would refuse a step prepared under
  the old one in the middle of its intent, and the signer would take a settings change from the
  engine at any time. Rejected: a restart writes the signer's settings once, as today.
- **Rebuild every part and swap them all at once.** It would cut work under way, or wait for it,
  for a change of a client id. Rejected.
- **Judge a key live unless it is listed as restart-only.** A part that copies a key at start and
  is never listed would make the notice claim a change it did not make. Rejected.
