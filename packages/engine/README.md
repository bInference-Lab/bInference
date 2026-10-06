# @binference/engine

## Purpose

The engine's domain and use cases: intents, policy, risk, confirmations, wallet queues, orders,
watchers, ledger and paper mode. It does no I/O; the composition root wires its ports.

Today it holds the intent state machine of [spec 6](../../docs/specs/intent-states.md): the 20
states, the transition table with its guards, the triggers that move an intent, the events that
record each move, the closed lists of reason codes and the auto-mode test. It also holds the policy
step of the money path, which checks each intent against the owner's limits and names every rule
it breaks, and the `PriceSource` port it prices outflows through.

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

Tests import the `PriceSource` contract suite and a fake from `@binference/engine/testing`.
