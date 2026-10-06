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
- Ports live in `src/ports.ts`; their contract suites and fakes ship from `src/testing.ts`
  (`@binference/engine/testing`), which only tests import.
- Tests sit beside the code as `*.test.ts`; invariants of spec 6 live in
  `*.property.test.ts` files.
