# @binference/engine

## Purpose

The engine's domain and use cases: intents, policy, risk, confirmations, wallet queues, orders,
watchers, ledger and paper mode. It does no I/O; the composition root wires its ports.

Today it holds the intent state machine of [spec 6](../../docs/specs/intent-states.md): the 20
states, the transition table with its guards, the triggers that move an intent, the events that
record each move, the closed lists of reason codes and the auto-mode test. It also holds the policy
step of the money path, which checks each intent against the owner's limits and names every rule
it breaks, pricing outflows through `@binference/chain`'s `PriceSource` port. The venue host runs
the quote and build step: it asks a venue for a quote, sets the trade's terms, and checks every
transaction the venue builds against them.

It also holds the confirmation step: the card of [spec 4](../../docs/specs/cards-and-messages.md)
as data (each line a message key with typed values, which every surface renders in the owner's
language), and the answers to it. The first answer that lands decides: the `ConfirmationStore`
writes each move as a compare-and-set on the intent's row version, so of two answers that race,
one closes the card and the other sees it closed. A tap on a quote older than the re-quote age
quotes and simulates again through the `QuoteSource` and `Simulator` ports, and opens the next card
version when the minimum out got worse than the tolerance. No answer before the expiry is a no.

`createEngine` puts steps 1 to 6 of the money path behind the protocol
([ARCHITECTURE.md section 7](../../docs/ARCHITECTURE.md#section-7)). `intent/propose` resolves a
swap against the agent's wallet and limits, asks the venue host for a quote, then runs the policy,
the venue host's build, the risk step, the simulation and the auto test, and answers with the
intent waiting on its card or ended. The policy prices a token without a feed from that quote
(`withQuotePrice` of `@binference/chain`), and nothing is built before the policy passes. A
request it cannot route yet is a protocol error, and nothing is stored. `intent/confirm` and
`intent/deny` answer the card through the confirmations. A confirmed intent then goes on to the
execute step: a paper intent fills at its confirmed quote (the paper fill) and never reaches the
`Executor` port, which takes each confirmed live intent onto its wallet's queue. The stored intents
are the one writer of intents: every new intent and every move goes through the `IntentStore` and
pushes its `intent`, card and `ledger` events, and they are the `ConfirmationStore` the
confirmations write through. What the money path reads about wallets outside the store comes through
the `WalletFactsSource` port.

Paper mode ([ARCHITECTURE.md section 10](../../docs/ARCHITECTURE.md#section-10)) keeps each agent's
paper portfolio as its wallets' paper positions, so a paper fill moves them at average cost and they
carry their own P&L. `portfolio/resetPaper` starts the portfolio again from the starting balances
(1 BNB and 500 USDT by default), each valued at its price when it arrives, and a paper intent's
balance comes from it. `agent/goLive` is the one way an agent goes live, once its wallet holds
funds; `agent/goPaper` brakes back. Each switch is journaled and announced on the `config` topic,
and `isFirstLiveCard` says when a card carries the first-live note.

The approval mode ([decision 0088](../../docs/DECISIONS.md#d0088)) is per agent: `manual` by
default, or `auto`. `approval/get` reads it; `approval/set` switches it, to `auto` with the `loosen`
scope and back to `manual` with `confirm`, and journals, pushes and announces each switch with the
`notice.approvalMode` notice. The auto test reads the agent as the move to `simulated` read it back,
so a switch to manual counts for every trade not yet at its auto test; the switch also raises the
mode's version, which ends the grant of every auto trade not yet signed. The auto grant, exported
as `@binference/engine/approval`, is what the signer checks before it signs a step of an intent the
auto mode authorized: the intent, its terms hash, the mode version that authorized it, the network
fee cap and an expiry. A trade the auto mode ran has no card, so it gets the `receipt.auto`
notice when it settles, or the paper fill's receipt on paper.

`wallet/list` lists an agent's wallets, or every agent's, oldest first, so the default wallet comes
first: each with the owner's label from the `WalletStore` (exported as `@binference/engine/wallets`)
and its address from custody, the account on the first registered chain where custody holds it.
A stored wallet custody holds nowhere fails the call with `wallet.custody_down`.

It declares the store ports, the engine's view of the state it keeps
([docs/specs/database.md](../../docs/specs/database.md) section 2): `IntentStore` (intents with
their events, card versions and confirmations, each move written whole with its ledger entry),
`LedgerStore`, `IdempotencyStore`, `InboxStore`, `AccessStore`, `AgentStore`, `WalletStore` and
`ConfigJournal`.
Their records cross the store worker boundary, so each has a zod schema. `@binference/store` holds
their SQLite adapters; `@binference/engine/testing` holds an in-memory fake and a contract suite for
each.

It holds the wallet queue (ARCHITECTURE.md rule 6), exported as `@binference/engine/wallet-queue`:
one queue per account, width 1, which owns the account's nonces. A work runs with the account's
slot, the only way to take a nonce and store a signed transaction. The slot gives the lowest free
nonce: the lowest nonce at or above both the chain's count (the `NonceSource` port of
`@binference/chain`) and every nonce a block holds, that no signed or sent transaction of the
account holds. A nonce given to a step that was never signed, or freed by a dropped transaction, is
given again first, so a refusal, a stop or a crash leaves no gap; the `TransactionStore` keeps
every nonce in use, so a new queue after a restart uses none twice.

It holds the simulation check (ARCHITECTURE.md section 7, step 5), exported as
`@binference/engine/simulation`: `createSimulationCheck` is the `Simulator` the money path and the
re-quote at a tap call. It runs a quote's steps unsent through the chain's `TxSimulator` of
`@binference/chain` and holds the wallet's net balance changes to the quote's terms: exactly the
input leaves, at least the minimum out arrives, no other asset leaves or arrives, and no allowance
is set but the plan's own approval. A step that reverts is `simulation_reverted`; any other
difference is `effects_differ`, and `checkEffects` names the check that failed. The network fee is
never among the transfers the simulation reports, so it is counted apart from them. A paper intent
simulates with its paper balances: for the run, the wallet holds what its paper positions hold of
the chain's coin and of the asset the quote spends, so a paper trade passes from an empty wallet.
It holds the engine's side of button surfaces, exported as `@binference/engine/surfaces`. Each
card version opens with a random callback reference, and the `IntentStore` finds a version by it.
`createCardShowings` draws an open card version from the stored intent, with the info of every
asset it names, and gives the receipt of a version an answer or the timer closed: with the paper
fill once a confirmed paper intent recorded it. `createCardPresses` answers the owner's press of a
Telegram button: it finds the card version by its reference, answers only for the owner's numeric
Telegram id, and stores the answer through the confirmations before it resolves. It is the
adapter of Telegram's `CardAnswers` port.

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
| `createConfirmations`, `Confirmations`                           | Applies the owner's answers and the card timer, first one wins  |
| `CardAnswer`, `AnswerResult`, `ExpiryResult`                     | An answer from a surface, and what became of it                 |
| `ConfirmationStore`, `QuoteSource`, `Simulator`                  | The ports the confirmations write, re-quote and simulate with   |
| `StoredIntent`, `IntentWrite`, `BuiltQuote`, `Requote`           | An intent as the store holds it, and one move to store          |
| `drawCard`, `Card`, `CardFacts`, `CardAction`                    | A card version as lines of message keys with typed values       |
| `CardLine`, `CardValue`, `cardKeys`                              | One line, its values, and every key a card or receipt uses      |
| `receiptLine`, `CardClosing`, `ReceiptFill`                      | The receipt line a card becomes when it closes, paper fills too |
| `isFirstLiveCard`                                                | Whether a card is the agent's first live one, which says so     |
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
| `PaperReset`, `paperResetSchema`                                 | A wallet's paper portfolio started again, stored all or nothing |
| `executionsCsv`, `executionsCsvColumns`                          | Executions as a CSV file for tax tools                          |
| `IdempotencyStore`, `InboxStore`                                 | Each write's result by its key; inbound events before the ack   |
| `AccessStore`, `TokenRecord`, `DeviceRecord`                     | Client tokens, console devices and pairing codes                |
| `AgentStore`, `AgentSettings`, `LimitsValues`                    | Agents with their limits and approval modes                     |
| `AgentModeChange`, `agentModeChangeSchema`                       | An agent's switch between paper and live, under its row version |
| `Executor`                                                       | Takes each confirmed live intent onto its wallet's queue        |
| `ConfigJournal`, `ConfigChange`                                  | Every config change, who made it and where                      |
| `WalletStore`, `WalletRecord`, `walletRecordSchema` (subpath)    | The agent wallets with the owner's labels, oldest first         |
| `EngineStores`                                                   | Every store port, as the composition root hands them out        |
| `TransactionStore`                                               | Each wallet's signed transactions and the nonces they hold      |
| `createWalletQueue`, `WalletQueue`, `WalletSlot` (subpath)       | One queue per account that owns its nonces                      |
| `lowestFreeNonce`, `isNonceFree`, `NonceGrant` (subpath)         | The rule the queue gives nonces by, and what it gives           |
| `SignedTransaction`, `TransactionRecord` (subpath)               | A step's signed transaction as the queue stores it              |
| `createSimulationCheck`, `SimulationCheckOptions` (subpath)      | The simulate step: a quote's steps run and checked              |
| `checkEffects`, `EffectBounds`, `SimulationMismatch` (subpath)   | Checks a simulation and names the first check it fails          |
| `autoModeGrantOf`, `autoModeTermsHash` (subpath `approval`)      | The auto grant of a stored intent, and the terms it binds       |
| `autoReceiptLine`, `AutoSettlement` (subpath)                    | The receipt of a trade the auto mode ran, paper fills too       |
| `BotUpdateSource`, `BotUpdate`                                   | A bot's inbound updates, answered again until acknowledged      |
| `ModelBilling`, `ModelCharge`                                    | Pays for model calls and says what an agent may still spend     |
| `MarketData`, `BlockReading`, `PriceReading`                     | The blocks and prices the watchers stream                       |
| `Sha256Hex`, `sha256Hex`                                         | A SHA-256 digest as 64 lowercase hex digits                     |
| `TransitionProblem`, `ProposalProblem`                           | Why the machine refused a trigger or a proposal                 |
| `createEngine`, `Engine`, `EngineOptions`, `EngineHandlers`      | The money path and the card answers behind their operations     |
| `EngineCall`, `EngineCaller`, `EngineHandler`, `AnswerCard`      | A call the server routes, and a card answer from any surface    |
| `EnginePush`, `PublishPush`                                      | What the engine pushes; the server numbers each topic's pushes  |
| `WalletFactsSource`, `WalletFacts`, `WalletFactsQuery`           | What the money path reads about an agent's wallets              |
| `createCardShowings`, `CardShowing`, `CardSettling` (subpath)    | A card version drawn for a button surface, and its receipt      |
| `createCardPresses`, `CardPress`, `CardStanding` (subpath)       | Answers the owner's Telegram press through the confirmations    |

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

````ts
import { createEngine, createVenueHost } from "@binference/engine";

const host = createVenueHost({ venues, chains, clock, callTimeoutMs: 5_000 });
const engine = createEngine({
  stores,
  positions,
  custody,
  prices,
  wallets,
  host,
  simulator,
  executor,
  paperBalances, // config's `defaults.paper.balances`, resolved to assets
  chains,
  clock,
  ids,
  publish: (push) => server.publish(push),
});
const server = createProtocolServer({ handlers: engine.handlers /* , ... */ });
A step of the execute step runs on its wallet's queue: a nonce, a signature, the save, then sends:

```ts
import { createWalletQueue } from "@binference/engine/wallet-queue";

const queue = createWalletQueue({ transactions, nonces, clock });
await queue.run(
  account,
  async (slot) => {
    const { nonce } = await slot.nextNonce({ signal });
    const signed = await signer.signTransaction(requestAt(nonce), { signal });
    // The raw transaction is stored before any send: recovery matches by hash and nonce.
    const saved = await slot.saveSigned(transactionOf(signed, nonce), { signal });
    return saved.ok ? send(saved.value) : saved;
  },
  { signal },
);
````

Tests import each port's contract suite and its fake from `@binference/engine/testing`;
`createMemoryEngineStores` gives every store port in memory over one shared ledger.
