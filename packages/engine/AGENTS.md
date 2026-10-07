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
- `BotUpdateSource`, `ModelBilling`, `MarketData` and `PriceSource` are profile parts
  (ARCHITECTURE.md section 30): each TSDoc names its adapters, and each fake in
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
  reports each outcome to the state machine as a trigger. A request it cannot route yet is a
  protocol error before anything is stored; every refusal after that is the intent's state. What it
  reads about wallets outside the store comes through `WalletFactsSource`, and a fact it cannot
  read fails closed (send level 3, no address book).
- The paper fill (`src/paper/`) moves a confirmed paper intent to `paper_filled` at its confirmed
  quote and records the fill with the move. The paper portfolio builds on this step.
- The operation handlers (`src/operations/`) have the protocol server's handler shape, call the use
  cases and map their outcomes to protocol error codes; they hold no rule of their own.
- The CSV export's header is a tax tool's import format, so it stays English in every language.
- Tests sit beside the code as `*.test.ts`; invariants of spec 6 live in
  `*.property.test.ts` files.
