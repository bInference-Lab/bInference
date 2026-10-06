# @binference/engine

## Purpose

The engine's domain and use cases: intents, policy, risk, confirmations, wallet queues, orders,
watchers, ledger and paper mode. It does no I/O; the composition root wires its ports.

Today it holds the intent state machine of [spec 6](../../docs/specs/intent-states.md): the 20
states, the transition table with its guards, the triggers that move an intent, the events that
record each move, the closed lists of reason codes and the auto-mode test.

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
| `TransitionProblem`, `ProposalProblem`                           | Why the machine refused a trigger or a proposal                 |

## Example

```ts
import { createIntentStateMachine } from "@binference/engine";

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
const checked = machine.apply(proposed.value.status, { type: "policy_passed" });
```
