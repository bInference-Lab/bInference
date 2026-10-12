# @binference/engine

Domain and use cases: intents, policy, risk, confirmations, wallet queues, orders, watchers,
ledger and paper mode.

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- It is pure money code: no I/O, no `Number` on an amount, time only through the `Clock` port and
  randomness only through the `Random` port. Use cases take their ports through a factory.
- Its public API is what `src/index.ts` exports; every export carries TSDoc.
- It meets the money bar: 95% lines and branches, and Stryker mutates it.
- `src/intents/state-machine.ts` is the one owner of intent states. No other module decides or
  writes a state. A new transition adds a row and its guard to `transition-table.ts`, a line to
  the table test and a property case, and follows a change to
  [spec 6](../../docs/specs/intent-states.md).
- Guards are pure: they read only their input. A step that owns a check (policy, venue, risk,
  simulation, wallet queue) reports its outcome as a trigger; the state machine decides.
- A reason code an intent stores is in a closed list in `intent-reason.ts`, and every code has an
  English and Chinese message `reason.<code>`.
- The policy step (`src/policy/`) decides and never writes. It reads prices only through the
  `PriceSource` port, rounds every USD value up, and names every rule an intent breaks in spec 6's
  order. A new rule takes its reason from that list and adds a property case. It compares assets
  in their family's canonical form (`canonicalAsset` of `@binference/chain`): a request's assets
  and the token lists take it where they enter, and the facts read a stored list in it.
- A card is data: each line a key of `cardKeys` with typed values, never English text. Every key
  has an English and Chinese message, and each surface renders the lines as `cardLineText`
  (`src/surfaces/card-text.ts`) writes them in plain text, escaping them for its own markup.
- The confirmation step (`src/confirmations/`) picks the trigger an answer or the card timer is,
  and writes only through the `ConfirmationStore`, under the row version it read; the state machine
  decides each move.
- The venue host (`src/venues/`) is the only caller of venue code. It sets every trade's terms,
  copies what a venue returns, and refuses what it cannot read: a throw or a timeout is
  `venue_down`, a failed check `decode_mismatch` with the check named. A new check is a
  `BuildMismatch` code, a case in `build-checks.test.ts` and a property case.
- Ports live in `src/ports.ts`, and custody's ceiling editor and wallet maker in
  `src/install/ports.ts`; their contract suites and fakes ship from `src/testing.ts`
  (`@binference/engine/testing`), which only tests import.
- The store ports in `src/ports.ts` (`IntentStore`, `LedgerStore`, `IdempotencyStore`,
  `InboxStore`, `AccessStore`, `AgentStore`, `InstallStore`, `ConfigJournal`, `NoticeStore`), and
  the owner's bot's `OwnerStore` and `CardCopyStore` in `src/surfaces/ports.ts`, and `OrderStore`
  in `src/orders/ports.ts`, are implemented in `@binference/store`, which imports this package. Each record they pass has a
  declared type and a zod schema, since it crosses the store worker boundary. A change to a store
  port changes its contract suite, its fake and its SQLite adapter together.
- `BotUpdateSource`, `ModelBilling`, `MarketData` and `PriceSource` (a port of `@binference/chain`,
  which the chain families implement) are profile parts (ARCHITECTURE.md section 30): each TSDoc
  names its adapters, and each fake in
  `@binference/engine/testing` is shaped like the hosted adapter (a webhook relay, prepaid credit, a
  shared market-data service). Nothing here names or reads a profile; `guards/no-profile-mention`
  fails code that does.
- The in-memory fakes check every rule a write must pass before they change anything, as the
  SQLite store's transaction does, and they fail with the same `store.*` codes.
- Positions (`src/positions/`) follow average cost (decision 0058) in bigint base units and
  micro-dollars, and move each dollar once: what a sale takes out of one position is the cost of
  the next. Values at the time round up, values now round down, the cost a sale takes rounds up and
  the last unit takes all that is left. A change to a rounding rule changes its unit test and its
  case in `*.property.test.ts`.
- Funds that arrive without a trade (a deposit, the paper starting balance) are an arrival: priced
  through `PriceSource` when they arrive, they open a position at that value. With no usable price
  the arrival is stored without a value and opens no position, and a sale of units no position
  holds counts no gain or loss.
- Funds a send takes out of a live wallet are a departure (decision 0127): the units sent and the
  gas leave their positions at average cost, the cost rounding down, with nothing realized. An
  intent's departures are stored once, with their position writes.
- `PositionStore` has its fake and contract suite; its SQLite adapter is
  `createSqlitePositionStore` in `@binference/store`.
- The ledger chain check (`src/ledger/`) reads entries and never writes.
- The stored intents (`src/intents/create-stored-intents.ts`) are the engine's one writer of
  intents: every new intent and every move goes through them, so each write lands as the state
  machine decided it and pushes its events. The confirmations write through them as their
  `ConfirmationStore`; nothing else calls `IntentStore.create` or `transition`.
- Auto orders (`src/orders/`, decision 0189): `order-machine.ts` decides every move of an order,
  as the intent state machine decides an intent's; the order store writes the moves under their
  versions and moves an order into `active` only on its `autoOrder` intent's confirmation, for an
  agent that is not frozen. A freeze and an unfreeze carry their order moves in their own write.
  A new trigger adds its rule, a row of `order-machine.test.ts` and a case of the property test.
- The money path (`src/money-path/`) runs the steps of ARCHITECTURE.md section 7 in order and
  reports each outcome to the state machine as a trigger. Only the venues' quotes run before the
  policy, which prices a token without a feed from the first venue's quote; no venue builds until
  the policy passes. The best quote (`choose-route.ts`, decision 0107) then builds and simulates
  every quote and ranks the plans in `rank-routes.ts` by what arrives net of the network fee; a
  change to the ranking changes its case in `rank-routes.property.test.ts`. A quote whose price
  impact is above the agent's maximum is never built, at a re-quote either, and the queue's recheck
  refuses one; with none left the intent ends `failed_check` with `price_impact`.
  A chosen route whose simulation failed ends `failed_check` with that reason right after
  `quote_built`, before any risk check (decision 0145).
  A request it cannot route yet is a protocol error before anything is stored; every
  refusal after that is the intent's state. What it reads about wallets outside the store comes
  through `WalletFactsSource`, and a fact it cannot read fails closed (no rescue address).
- The execute step (`src/money-path/execute-confirmed.ts`) is the one place a confirmed intent
  goes on: a paper intent to the paper fill, a live one, a rescue in paper mode too (decision
  0100), to the `Executor` port. A paper intent never reaches the executor (spec 6, invariant 3);
  its property test holds that for every kind, mode and state.
- The lock (`isLocked`) says the unlock mode has not given the engine the agent key. Only the
  answer step and the auto test read it: a Confirm of a live intent is refused as `locked` before
  anything is stored, and auto mode leaves a live intent to the owner. Reads, paper intents and
  Cancel never look at it (keys spec, section 3).
- The paper fill (`src/paper/`) moves a confirmed paper intent to `paper_filled` at its confirmed
  quote and records the fill with the move, then records it as a paper execution, valued at the
  sold asset's price then. With no usable price the intent stays `confirmed`: a fill is never
  valued at a guessed price.
- The paper simulation (`src/paper/paper-simulation.ts`) gives a paper intent its paper balances.
  A paper sale of a token whose balance the chain's simulator cannot set (`chain.balance_unset`:
  a reflection or rebasing token) runs nothing and passes as an estimate at the quote's amounts,
  which the card says (`card.warn.paperEstimate`). A live trade always needs its simulation.
- The paper portfolio is the agent's wallets' paper positions: a paper intent's native balance is
  its paper position of the native coin. A reset empties every paper position of the agent's
  wallets, P&L too, and opens the starting balances in its first wallet, each at its price when it
  arrives; with no usable price it changes nothing. It never touches a live position or the mode.
- `agent/goLive` is the only operation that switches an agent to live, and only once its default
  wallet holds funds; `agent/goPaper` brakes. Intents keep the mode they were proposed in. Each
  switch is journaled and pushed as `config/changed`.
- Every change to a setting or a limit (a mode, the approval mode, limits, the send level, the
  address book, the rescue address) goes through `journalConfigChange` (`src/audit/`): it
  journals who made it and where, pushes `config/changed`, then publishes the notices that
  announce it. A new setting's writer calls it too, never the `ConfigJournal` by hand.
  `config/history` reads the journal back, a page at a time, in the order it was recorded. The
  `audit` subpath exports it with the config reload's notices, for the composition root.
- The approval mode (`src/approval/`, exported as `@binference/engine/approval`) is switched only by
  `approval/set`: `auto` needs the `loosen` scope, `manual` needs `confirm`, and every switch raises
  the mode's version, is journaled, pushed as `config/changed` and announced as the
  `notice.approvalMode` notice. The auto test reads the agent's settings from the snapshot of the
  move to `simulated`, never from the start of the run. An auto grant holds for one intent, its
  terms hash and the mode version that authorized it, up to the network fee cap, until its expiry.
  Its type, schema and check live in `@binference/chain`, which the signer's hard rule 5 runs; the
  engine makes grants (`autoModeGrantOf`) and its tests hold them to that check. Its property test
  (`auto-mode.property.test.ts`) runs the whole engine.
- The send level (`src/send-levels/`) changes only through `sendLevel/set` and
  `sendLevel/cancelPending`, which decide with `moveSendLevel` (`src/policy/send-level-change.ts`):
  a stricter level applies at once, a looser one waits 24 hours and needs `loosen`. Every reader of
  a stored level takes the level in effect through `sendLevelAt`, never the row's `level` alone.
  Each change is journaled, pushed as `config/changed`, and announced: a moved level as the
  `notice.sendLevel` notice, a looser level gone before its time as `notice.sendLevelCancelled`.
- An agent's limits (`src/limits/`) change only through `limit/set` and `limit/cancelPending`,
  which decide with `moveLimits` (`src/policy/limit-change.ts`, decision 0111): a clearly stricter
  value applies at once with `confirm`, every other change needs `loosen` and waits 24 hours in
  `pending_limits`. `createEngine` wraps the agent store in `withLimitsInEffect`, so every part
  reads the limits in effect, waiting ones folded in at their time; a venue added while a live
  wallet's ceiling leaves its contracts out is `limit.over_ceiling`. Each move is journaled, pushed
  as `config/changed`, and announced per limit as `notice.limitChange` and
  `notice.limitChangeCancelled`.
- The address book lives in the agent's settings: the policy reads every live entry, on every
  chain, and counts one as saved only once the owner key put it in the ceiling. Level 2 lets a send
  pay an entry only from its `usableAtMs`, 24 hours after it was saved. Its handlers
  (`src/address-book/`) list entries and remove one as braking, with `confirm`, journaled; adding
  one saves it in the ceiling, so it needs the owner key.
- The rescue address (`src/safety/`) changes only through `safety/setRescueAddress`, with the
  owner key over IPC, and `safety/cancelRescueChange`, which the install store writes as
  `changeRescue` and `cancelRescue` (`src/policy/rescue-change.ts`) decide inside its transaction:
  any new address waits 24 hours, is announced, and can be cancelled, which is announced too. Every
  reader of the stored address takes the one in effect through `rescueAt`. The owner key saves the
  new address in every live wallet's ceiling through the `CeilingEditor` port at once and signs
  ahead the changes that leave the old or the new address out (decision 0110); `Engine.settle`
  sends the first once the change takes effect, a cancel the second.
- A ceiling's contract calls (`src/ceilings/`) change only through `ceiling/set`, with the owner
  key over IPC (decision 0132): the venues and the per-transaction cap of every live wallet of the
  agent, on the chains each ceiling enables. Other chains are `protocol.bad_args`, as a new chain
  needs a new wallet, and removing a venue the agent's limits name, in effect or waiting, is
  `limit.venue_in_use`. Each wallet's stored copy of its ceiling is read back through
  `InstallStore.updateCeiling`, which `limit/set` checks venues against; a change that moved one is
  journaled, pushed as `config/changed`, and announced as `notice.ceilingChange`.
- A wallet's key leaves custody only through `wallet/exportSealed`, a read over IPC with the owner
  key (decision 0131): custody seals it with HPKE to the recipient key the CLI made, and the engine
  passes the sealed key on and keeps it nowhere, not in the idempotency store either.
- A machine's agent key leaves the wallets only through `signer/revoke`
  (`src/operations/revoke-signer.ts`), with the owner key over IPC (decision 0140): custody removes
  it from every live wallet through the `SignerRevoker` port, never this engine's own key
  (`signer.own_key`) and never a wallet's last signer (`signer.last_signer`), and the removal is
  announced as `notice.signerRevoked`.
- A freeze (`src/safety/freeze-agents.ts`, `safety/freeze`) is one write of the intent store's
  `freeze`: each agent marked frozen, keeping the time of an earlier freeze, and each unsigned
  intent of theirs moved to `cancelled` by the state machine, a rescue excepted (decision 0099),
  with the freeze's own ledger entries; a write another write beat is read and tried again. A
  whole-install freeze also marks the install frozen, and the agent store creates every agent
  frozen while it is. Each newly frozen agent is announced with `notice.frozen`. The policy's `frozen` rule keeps every
  later intent and auto order fill of the agent out.
- A rescue (`src/safety/`, `safety/rescue`) is one live intent stored under the first wallet that
  moves something and whose agent is active, whatever the agents' modes, freezes and send levels.
  It plans every wallet of the install on the rescue address's chain: each token the registry
  lists or the wallet holds a live position in, whole, and the native coin above the agent's gas
  reserve, never a sale. Its quote is a `RescueQuote` in the `quote` column, so the card's terms
  hash binds every move and the wallet that signs it; each wallet's sends are simulated, and a
  move that would not run as planned is left out. While a rescue has not ended, `safety/rescue`
  answers that one. A confirmed rescue is announced with `notice.rescue`.
- An unfreeze (`src/safety/`, `safety/unfreeze`, decision 0128) is one live `unfreeze` intent of the
  owner's: it runs to its card at once, with its `UnfreezeQuote` (the agents and whether the
  install's freeze lifts) in the `quote` column, and never passes the auto test. The tap's execute
  step writes it with the intent store's `freeze`, `isFrozen: false`, which moves it from
  `confirmed` to `reconciled` on `unfreeze_written`; the executor never takes one. Each unfreeze is
  announced with `notice.unfrozen`.
- `safety/status` (`src/safety/safety-status-handlers.ts`) reads, for any surface with `read`:
  whether anything is frozen, the install's freeze, each frozen agent not archived with its time,
  the rescue that has not ended, and the rescue address in effect with a change that waits.
- The executor runs a confirmed rescue (`src/executor/execute-rescue.ts`) wallet by wallet, each
  on its own queue, each step a `send` its move's wallet signs to the address the card confirmed,
  which must still be the rescue address in effect. A failed step is tried again up to three
  times once its transaction is final, and a restart goes on from where it stood without signing
  a sent step again. It reconciles once its landed sends are stored as departures
  (`src/executor/reconcile-rescue.ts`).
- The low-gas alert (`src/gas/`) reads each live wallet's native balance as the money path
  resolves a proposal, and announces `notice.lowGas` once the balance is below twice the reserve,
  then not again until a reading shows it back at or above that. It keeps that memory in a bounded
  set and never throws; the policy, not the alert, keeps trades out of the reserve. `checkGas`
  (`check-gas.ts`) hands the same alert a reading of every wallet of every live agent, on each
  chain the agent keeps a reserve on, for the composition root's timer; a failed read is thrown
  once every wallet is read.
- Notices (`src/notices/`, exported as `@binference/engine/notices`, decision 0133):
  `noticeRecordOf` gives a notice its kind, its level and a `queued` delivery for each chat
  surface, and `createNoticeHandlers` answers `notice/list`. The composition root's notice log is
  their one writer. A surface moves a delivery only through `NoticeStore.move`, from the state it
  read, and back from `unknown_after_send` to `queued` only when the surface answered a refusal,
  so nothing went out. Each agent's notice settings (`notice-settings.ts`, decision 0185) name the
  kinds it muted; `isNoticeMutedFor` is the log's check, and a security notice is never muted.
  `notice/getSettings` and `notice/setSettings` read and journal them.
- The operation handlers (`src/operations/`) have the protocol server's handler shape, call the use
  cases and map their outcomes to protocol error codes; they hold no rule of their own.
- Button surfaces (`src/surfaces/`, exported as `@binference/engine/surfaces`) read cards and
  answer presses; they decide nothing. What every surface shows alike, such as an agent's limits
  (`limitLines`), is drawn there once. The owner's Telegram fast commands run their operations
  through `createOwnerCalls`, only for the owner's numeric Telegram id, as the caller
  `{ kind: "telegram" }` with `read` and `confirm`: what they change is journaled, ledgered and
  announced as done from Telegram, and an operation joins `ownerChatOperations` only when its
  scope is one of those two. The one exception is `config/change` with the patch
  `{ owner: { locale } }` alone (decision 0134); any other patch from the chat is `auth.scope`. A card version is drawn from the stored intent, a press is
  answered only for the owner and only through the answer step, and every card version carries a
  callback reference from the `Random` port, never an id.
- The wallet queue (`src/wallet-queue/`, exported as `@binference/engine/wallet-queue`) runs one
  work per account at a time and is the only way to take a nonce and store a signed transaction.
  It gives nonces by the lowest free nonce rule in `lowest-free-nonce.ts`, which the fake and the
  SQLite store both call, and keeps nothing across a restart that the store does not hold. A
  node's pending count past the mined count by a nonce no stored transaction of the wallet holds
  is refused as `wallet_queue.nonce_ahead`, so no step signs at a nonce that leaves a gap. A
  change to the rule changes its property test and the `TransactionStore` contract suite.
- The executor (`src/executor/`, exported as `@binference/engine/executor`) runs a confirmed live
  intent on its wallet's queue and moves it only through the stored intents. Everything that can
  refuse before a signature (the `queue_took` check, a draft that would fail, a fee per gas above
  the network fee cap) runs before the move to `executing`, so such an intent stays `confirmed` with
  nothing signed; one above the cap tries again each block until the fee falls, and a tapped one
  whose confirmation runs out meanwhile gets the next card version with `notice.feeAboveCap`
  (decision 0143). No step or replacement is signed above the cap. Each step's raw bytes are stored
  before any send; a send no relay accepts goes again with the same stored bytes. A stuck step
  follows spec 6, section 6 in `stuck-rules.ts`, only on its wallet's slot: the same bytes again
  while it still runs, a speed-up after `replaceAfterBlocks`, a cancel once it would fail, each at
  its nonce for at least `leastReplacementFee` and never above the network fee cap. A step every
  relay turns away for `droppedAfterBlocks` blocks, its nonce still free by the latest and the
  pending count and none of its transactions known to a node, is dropped: its nonce goes to the next
  step and the intent ends with `stuck_dropped` (decision 0115). A step no rule can move waits as
  long for that, then hands over at the seam `executor.step_stopped` logs and holds its wallet's
  queue, with `notice.walletHeld`, until a block holds it or the drop rule drops it. Reconciliation
  reads what each final step moved only through the `ReceiptReader`, records the trade in the
  positions before the move to `reconciled`, and finds it stored after a restart, so a trade is
  recorded once. `recover` signs nothing: each stored step is looked up by hash and nonce (spec 6,
  section 7). The watch and recovery read every transaction of a step's nonce, so whichever lands is
  the step's, and a landed cancel ends the intent with `stuck_cancelled`; recovery never replaces a
  stuck step. A step that is never signed, at a run or found at recovery, ends the intent through
  `step_unsent`: `cancelled` when no step was signed, `failed_onchain` once one landed (decision
  0109). A confirmed intent whose confirmation or auto grant ran out while the engine was stopped or
  locked expires at recovery, through `authorization_lapsed` (decision 0120). `close` follows the
  engine's shutdown order (ARCHITECTURE.md section 24): it takes nothing more, every wait ends and
  no step or replacement starts, while a signature or a send under way runs to its end within the
  shutdown's budget.
- The risk step (`src/risk/`, exported as `@binference/engine/risk`) weighs the token a quoted
  trade buys; a sale passes it, and its own simulation decides. A token the registry lists passes
  without asking anyone. Any other needs a report from every required `TokenRiskSource`, each
  through the `RiskCacheStore` under its own timeout, and the round trip: a buy, a transfer and a
  sale from two accounts the chain's family makes fresh from the `Random` port, built on the
  trade's own venue and run through the `TxSimulator` port. Each leg's tax is read from the
  transfers alone (`leg-taxes.ts`, `sale-tax.ts`), never from a source's figure. The verdict
  (`risk-verdict.ts`) stores the first of spec 6's risk reasons that holds; a source or a round
  trip that cannot answer is a refusal, never a throw. A new finding that blocks adds its check
  there, a case in `risk-verdict.test.ts` and, for a tax rule, a property case.
- The simulation check (`src/simulation/`, exported as `@binference/engine/simulation`) reads
  what a quote's steps do only through the `TxSimulator` port, compares accounts through the
  chain's family, and never counts the network fee among the transfers. A new check is a
  `SimulationMismatch` code, a case in `check-effects.test.ts` and a property case.
- The CSV export's header is a tax tool's import format, so it stays English in every language.
  The tax export holds live executions only; paper executions get their own export.
- Tests sit beside the code as `*.test.ts`; invariants of spec 6 live in
  `*.property.test.ts` files.
