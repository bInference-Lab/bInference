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
  order. A new rule takes its reason from that list and adds a property case.
- A card is data: each line a key of `cardKeys` with typed values, never English text. Every key
  has an English and Chinese message, and each surface renders the lines.
- The confirmation step (`src/confirmations/`) picks the trigger an answer or the card timer is,
  and writes only through the `ConfirmationStore`, under the row version it read; the state machine
  decides each move.
- The venue host (`src/venues/`) is the only caller of venue code. It sets every trade's terms,
  copies what a venue returns, and refuses what it cannot read: a throw or a timeout is
  `venue_down`, a failed check `decode_mismatch` with the check named. A new check is a
  `BuildMismatch` code, a case in `build-checks.test.ts` and a property case.
- Ports live in `src/ports.ts`; their contract suites and fakes ship from `src/testing.ts`
  (`@binference/engine/testing`), which only tests import.
- The store ports in `src/ports.ts` (`IntentStore`, `LedgerStore`, `IdempotencyStore`,
  `InboxStore`, `AccessStore`, `AgentStore`, `ConfigJournal`) are implemented in
  `@binference/store`, which imports this package. Each record they pass has a declared type and a
  zod schema, since it crosses the store worker boundary. A change to a store port changes its
  contract suite, its fake and its SQLite adapter together.
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
- `PositionStore` has its fake and contract suite; its SQLite adapter comes with the first step
  that stores executions.
- The ledger chain check (`src/ledger/`) reads entries and never writes.
- The stored intents (`src/intents/create-stored-intents.ts`) are the engine's one writer of
  intents: every new intent and every move goes through them, so each write lands as the state
  machine decided it and pushes its events. The confirmations write through them as their
  `ConfirmationStore`; nothing else calls `IntentStore.create` or `transition`.
- The money path (`src/money-path/`) runs the steps of ARCHITECTURE.md section 7 in order and
  reports each outcome to the state machine as a trigger. Only the venue's quote runs before the
  policy, so the caps price a token without a feed from it; the venue builds nothing until the
  policy passes. A request it cannot route yet is a protocol error before anything is stored; every
  refusal after that is the intent's state. What it reads about wallets outside the store comes
  through `WalletFactsSource`, and a fact it cannot read fails closed (send level 3, no address
  book).
- The execute step (`src/money-path/execute-confirmed.ts`) is the one place a confirmed intent
  goes on: a paper intent to the paper fill, a live one, a rescue in paper mode too (decision
  0100), to the `Executor` port. A paper intent never reaches the executor (spec 6, invariant 3);
  its property test holds that for every kind, mode and state.
- The paper fill (`src/paper/`) moves a confirmed paper intent to `paper_filled` at its confirmed
  quote and records the fill with the move, then records it as a paper execution, valued at the
  sold asset's price then. With no usable price the intent stays `confirmed`: a fill is never
  valued at a guessed price.
- The paper portfolio is the agent's wallets' paper positions: a paper intent's native balance is
  its paper position of the native coin. A reset empties every paper position of the agent's
  wallets, P&L too, and opens the starting balances in its first wallet, each at its price when it
  arrives; with no usable price it changes nothing. It never touches a live position or the mode.
- `agent/goLive` is the only operation that switches an agent to live, and only once its default
  wallet holds funds; `agent/goPaper` brakes. Intents keep the mode they were proposed in. Each
  switch is journaled and pushed as `config/changed`.
- The approval mode (`src/approval/`, exported as `@binference/engine/approval`) is switched only by
  `approval/set`: `auto` needs the `loosen` scope, `manual` needs `confirm`, and every switch raises
  the mode's version, is journaled, pushed as `config/changed` and announced as the
  `notice.approvalMode` notice. The auto test reads the agent's settings from the snapshot of the
  move to `simulated`, never from the start of the run. An auto grant holds for one intent, its
  terms hash and the mode version that authorized it, up to the network fee cap, until its expiry;
  a change to its shape changes its schema, its check and the signer's hard rule 5 together. Its
  property test (`auto-mode.property.test.ts`) runs the whole engine.
- The operation handlers (`src/operations/`) have the protocol server's handler shape, call the use
  cases and map their outcomes to protocol error codes; they hold no rule of their own.
- Button surfaces (`src/surfaces/`, exported as `@binference/engine/surfaces`) read cards and
  answer presses; they decide nothing. A card version is drawn from the stored intent, a press is
  answered only for the owner and only through the answer step, and every card version carries a
  callback reference from the `Random` port, never an id.
- The wallet queue (`src/wallet-queue/`, exported as `@binference/engine/wallet-queue`) runs one
  work per account at a time and is the only way to take a nonce and store a signed transaction.
  It gives nonces by the lowest free nonce rule in `lowest-free-nonce.ts`, which the fake and the
  SQLite store both call, and keeps nothing across a restart that the store does not hold. A
  change to the rule changes its property test and the `TransactionStore` contract suite.
- The simulation check (`src/simulation/`, exported as `@binference/engine/simulation`) reads
  what a quote's steps do only through the `TxSimulator` port, compares accounts through the
  chain's family, and never counts the network fee among the transfers. A new check is a
  `SimulationMismatch` code, a case in `check-effects.test.ts` and a property case.
- The CSV export's header is a tax tool's import format, so it stays English in every language.
  The tax export holds live executions only; paper executions get their own export.
- Tests sit beside the code as `*.test.ts`; invariants of spec 6 live in
  `*.property.test.ts` files.
