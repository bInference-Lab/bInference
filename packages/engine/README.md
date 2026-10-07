# @binference/engine

## Purpose

The engine's domain and use cases: intents, policy, risk, confirmations, wallet queues, orders,
watchers, ledger and paper mode. It does no I/O; the composition root wires its ports.

Today it holds the intent state machine of [spec 6](../../docs/specs/intent-states.md): the 20
states, the transition table with its guards, the triggers that move an intent, the events that
record each move, the closed lists of reason codes and the auto-mode test. It also holds the policy
step of the money path, which checks each intent against the owner's limits and names every rule
it breaks, and the `PriceSource` port it prices outflows through. The venue host runs the quote
and build step: it asks a venue for a quote, sets the trade's terms, and checks every transaction
the venue builds against them.

It also holds the confirmation step: the card of [spec 4](../../docs/specs/cards-and-messages.md)
as data (each line a message key with typed values, which every surface renders in the owner's
language), and the answers to it. The first answer that lands decides: the `ConfirmationStore`
writes each move as a compare-and-set on the intent's row version, so of two answers that race,
one closes the card and the other sees it closed. A tap on a quote older than the re-quote age
quotes and simulates again through the `QuoteSource` and `Simulator` ports, and opens the next card
version when the minimum out got worse than the tolerance. No answer before the expiry is a no.

`createEngine` puts steps 1 to 6 of the money path behind the protocol
([ARCHITECTURE.md section 7](../../docs/ARCHITECTURE.md#section-7)). `intent/propose` resolves a
swap against the agent's wallet and limits, then runs the policy, the venue host, the risk step,
the simulation and the auto test, and answers with the intent waiting on its card or ended. A
request it cannot route yet is a protocol error, and nothing is stored. `intent/confirm` and
`intent/deny` answer the card through the confirmations, and a confirmed paper intent fills at its
confirmed quote (the paper fill). The stored intents are the one writer of intents: every new
intent and every move goes through the `IntentStore` and pushes its `intent`, card and `ledger`
events, and they are the `ConfirmationStore` the confirmations write through. What the money path
reads about wallets outside the store comes through the `WalletFactsSource` port.

It declares the store ports, the engine's view of the state it keeps
([docs/specs/database.md](../../docs/specs/database.md) section 2): `IntentStore` (intents with
their events, card versions and confirmations, each move written whole with its ledger entry),
`LedgerStore`, `IdempotencyStore`, `InboxStore`, `AccessStore`, `AgentStore` and `ConfigJournal`.
Their records cross the store worker boundary, so each has a zod schema. `@binference/store` holds
their SQLite adapters; `@binference/engine/testing` holds an in-memory fake and a contract suite for
each.

It checks the ledger and keeps the books. `walkLedgerChain` walks the hash chain through the
`LedgerStore` from genesis or a trusted checkpoint and names the first entry that breaks it, so an
edited, removed or added row is found. `createPositions` values each executed trade at the prices
of its time and stores it through the `PositionStore` with the position changes it makes, at
average cost with fees and gas ([decision 0058](../../docs/DECISIONS.md#d0058)); it values
positions now through the `PriceSource`. `executionsCsv` writes executions as a CSV file in the
layout of Koinly's universal import, which tax tools read.

## API

| Export                                                           | What it does                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `createIntentStateMachine`                                       | The one owner of intent states: proposes and moves intents      |
| `IntentStatus`, `IntentStep`, `IntentEvent`                      | An intent as the machine sees it, and the event of each move    |
| `IntentTrigger`, `TriggerFacts`, `triggerTypes`                  | What can happen to an intent, with the facts the guards read    |
| `intentStates`, `terminalStates`, `isTerminalState`              | The 20 states and the 9 that end an intent                      |
| `listTransitions`                                                | Every transition the table allows                               |
| `policyReasons`, `riskReasons`, `checkReasons`, `failureReasons` | The closed lists of reason codes, by the state that stores them |
| `intentReasons`                                                  | Every reason code once, each with a `reason.<code>` message     |
| `checkAutoMode`                                                  | The auto-mode test: authorizes an intent or names why it asks   |
| `needsLedgerEntry`                                               | Whether a transition into a state writes a ledger entry         |
| `createPolicyCheck`                                              | The policy step: passes an intent or names every rule it breaks |
| `PolicySubject`, `PolicyFacts`, `PolicyLimits`, `PolicyVerdict`  | What the policy reads and what it answers                       |
| `PriceSource`, `UsdPrice`                                        | The port that prices an asset in micro-dollars per base unit    |
| `createConfirmations`, `Confirmations`                           | Applies the owner's answers and the card timer, first one wins  |
| `CardAnswer`, `AnswerResult`, `ExpiryResult`                     | An answer from a surface, and what became of it                 |
| `ConfirmationStore`, `QuoteSource`, `Simulator`                  | The ports the confirmations write, re-quote and simulate with   |
| `StoredIntent`, `IntentWrite`, `BuiltQuote`, `Requote`           | An intent as the store holds it, and one move to store          |
| `drawCard`, `Card`, `CardFacts`, `CardAction`                    | A card version as lines of message keys with typed values       |
| `CardLine`, `CardValue`, `cardKeys`                              | One line, its values, and every key a card or receipt uses      |
| `receiptLine`, `CardClosing`                                     | The receipt line a card becomes when it closes                  |
| `createVenueHost`, `VenueHost`, `VenueTrade`, `TradePlan`        | Quotes and builds a trade on a venue and checks every step      |
| `VenueOutcome`, `VenueRefused`, `BuildMismatch`, `PlanStep`      | A checked plan, or the check reason and the check that failed   |
| `IntentStore`, `IntentDraft`, `IntentChange`, `IntentCommit`     | Intents with their events, cards and confirmations              |
| `IntentRecord`, `CardRecord`, `StoredConfirmation`               | An intent, a card version and a confirmation as stored          |
| `LedgerStore`, `LedgerEntry`, `chainLedgerEntry`                 | The hash-chained ledger and how an entry joins its end          |
| `hashLedgerEntry`, `genesisLedgerHash`                           | The SHA-256 of one ledger entry, and the first `prevHash`       |
| `walkLedgerChain`, `checkLedgerChain`, `LedgerCheckpoint`        | Walks the hash chain and names the first entry that breaks it   |
| `createPositions`, `Positions`, `ExecutedTrade`                  | Stores a trade with its position changes; values positions now  |
| `applyExecution`, `valueExecution`                               | One execution's average-cost moves, and its USD values          |
| `PositionStore`, `PositionRecord`, `ExecutionRecord`             | Executions and the positions they move, stored together         |
| `executionsCsv`, `executionsCsvColumns`                          | Executions as a CSV file for tax tools                          |
| `IdempotencyStore`, `InboxStore`                                 | Each write's result by its key; inbound events before the ack   |
| `AccessStore`, `TokenRecord`, `DeviceRecord`                     | Client tokens, console devices and pairing codes                |
| `AgentStore`, `AgentSettings`, `LimitsValues`                    | Agents with their limits and approval modes                     |
| `ConfigJournal`, `ConfigChange`                                  | Every config change, who made it and where                      |
| `EngineStores`                                                   | Every store port, as the composition root hands them out        |
| `TransactionStore`                                               | Each wallet's signed transactions and the nonces they hold      |
| `lowestFreeNonce`, `isNonceFree`, `NonceGrant` (subpath)         | The rule the queue gives nonces by, and what it gives           |
| `SignedTransaction`, `TransactionRecord` (subpath)               | A step's signed transaction as the queue stores it              |
| `BotUpdateSource`, `BotUpdate`                                   | A bot's inbound updates, answered again until acknowledged      |
| `ModelBilling`, `ModelCharge`                                    | Pays for model calls and says what an agent may still spend     |
| `MarketData`, `BlockReading`, `PriceReading`                     | The blocks and prices the watchers stream                       |
| `Sha256Hex`, `sha256Hex`                                         | A SHA-256 digest as 64 lowercase hex digits                     |
| `TransitionProblem`, `ProposalProblem`                           | Why the machine refused a trigger or a proposal                 |
| `createEngine`, `Engine`, `EngineOptions`, `EngineHandlers`      | The money path and the card answers behind their operations     |
| `EngineCall`, `EngineCaller`, `EngineHandler`, `AnswerCard`      | A call the server routes, and a card answer from any surface    |
| `EnginePush`, `PublishPush`                                      | What the engine pushes; the server numbers each topic's pushes  |
| `WalletFactsSource`, `WalletFacts`, `WalletFactsQuery`           | What the money path reads about an agent's wallets              |

## Example

```ts
import { createIntentStateMachine, createPolicyCheck } from "@binference/engine";

const machine = createIntentStateMachine({ clock });
const proposed = machine.propose({
  kind: "swap",
  proposer: "agent_runtime",
  isPaper: false,
  hasOutsideContent: false,
  agentStatus: "active",
});
if (!proposed.ok) {
  return proposed;
}
const policy = createPolicyCheck({ prices, clock });
const verdict = await policy.check(subject, facts, { signal });
const checked = machine.apply(
  proposed.value.status,
  verdict.ok ? { type: "policy_passed" } : { type: "policy_refused", reason: verdict.error },
);
```

A surface answers a card and renders what comes back:

```ts
import { createConfirmations, receiptLine } from "@binference/engine";

const confirmations = createConfirmations({ clock, store, quotes, simulator });
const answered = await confirmations.answer(
  { intent, decision: "confirm", cardVersion: 1, answeredBy: { surface: "telegram", by: userRef } },
  { signal },
);
if (answered.ok && answered.value.intent.closing !== undefined) {
  const receipt = receiptLine(answered.value.intent.closing); // every copy of the card shows it
}
```

A reconcile step records a trade, and `binference check` walks the ledger:

```ts
import { createPositions, walkLedgerChain } from "@binference/engine";

const positions = createPositions({ store: positionStore, prices });
const recorded = await positions.record(trade, { signal }); // `stale`: read again and retry
const chain = await walkLedgerChain(ledger, {}, { signal });
if (!chain.ok) {
  report(chain.error, chain.seq); // a critical finding of `binference check`
}
```

The composition root builds the engine from ports and hands its handlers to the protocol server:

```ts
import { createEngine, createVenueHost } from "@binference/engine";

const host = createVenueHost({ venues, chains, clock, callTimeoutMs: 5_000 });
const engine = createEngine({
  stores,
  custody,
  prices,
  wallets,
  host,
  simulator,
  chains,
  clock,
  ids,
  publish: (push) => server.publish(push),
});
const server = createProtocolServer({ handlers: engine.handlers /* , ... */ });
```

Tests import each port's contract suite and its fake from `@binference/engine/testing`;
`createMemoryEngineStores` gives every store port in memory over one shared ledger.
