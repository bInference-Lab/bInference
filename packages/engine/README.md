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
| `TransitionProblem`, `ProposalProblem`                           | Why the machine refused a trigger or a proposal                 |

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

Tests import each port's contract suite and a fake from `@binference/engine/testing`.
