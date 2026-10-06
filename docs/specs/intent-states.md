# Spec 6: the intent state machine

Status: accepted on 2026-10-06 ([decision 0093](../DECISIONS.md#d0093)).

An intent is one action the owner may confirm: a swap, a send, a lend, a rescue, an order fill. It
moves through fixed states under one owner, the module `engine/src/intents/state-machine.ts`. No
other code writes an intent's state ([ENGINEERING.md principle 2](../ENGINEERING.md#section-1)).

<a id="section-1"></a>

## 1. Parts of an intent

- **The request**: what was asked (protocol spec 8.1), stored as given.
- **The plan**: one or more steps, each an unsigned transaction with its decoded effect. A swap with
  an approval has two steps: an exact approval, then the swap. A rescue has one step per token per
  wallet.
- **The card**: what the owner sees and confirms, in versions. A new quote with worse terms makes a
  new version ([rule 4](../ARCHITECTURE.md#rule-4)).
- **Transactions**: each step's signed transaction and its fate, in their own records (section 6).
- **Events**: every transition, appended to `intent_events` and the ledger (section 8).

<a id="section-2"></a>

## 2. States

| State                   | Meaning                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `proposed`              | Stored; nothing checked yet                                                                       |
| `checked`               | Resolved and passed policy                                                                        |
| `quoted`                | A venue gave a quote and built the steps; the decode matches the request                          |
| `assessed`              | Token risk passed (or does not apply)                                                             |
| `simulated`             | The simulation's balance changes match the request                                                |
| `awaiting_confirmation` | A card is open on the owner's surfaces                                                            |
| `confirmed`             | The owner tapped, or an approved auto order or webhook rule authorized it                         |
| `executing`             | Steps are being signed and sent through the wallet queue                                          |
| `included`              | Every step is in a block                                                                          |
| `finalized`             | Every step's block is final: at or below the chain's `finalized` block (the chain family decides) |
| `reconciled`            | Fills decoded, positions and P&L updated, ledger closed. Terminal.                                |
| `paper_filled`          | Paper mode: filled at the confirmed quote; nothing was signed. Terminal.                          |
| `rejected_policy`       | Policy refused it. Terminal.                                                                      |
| `risk_blocked`          | Token risk refused it. Terminal.                                                                  |
| `failed_check`          | Quote, build, decode or simulation failed. Terminal.                                              |
| `denied`                | The owner tapped Cancel. Terminal.                                                                |
| `expired`               | No answer before the card expired. Terminal.                                                      |
| `cancelled`             | Withdrawn before signing: by the proposer, a freeze, or the engine stopping. Terminal.            |
| `failed_onchain`        | A step reverted or was replaced by a cancel. Terminal.                                            |
| `unknown_after_send`    | A step's fate is unknown after a crash; reconciliation is running                                 |

`unknown_after_send` is not terminal: it ends in `reconciled` or `failed_onchain` (section 7).

<a id="section-3"></a>

## 3. Transitions

Each row is the only way into its target state. Guards are checked inside the same database
transaction as the write ([ENGINEERING.md section 10](../ENGINEERING.md#section-10)).

| From                         | To                      | Trigger                                                            | Guard                                                                                                                                                                                                  |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (none)                       | `proposed`              | `intent/propose`, an order fill, a webhook alert, `safety/rescue`  | args valid; agent exists and is not archived                                                                                                                                                           |
| `proposed`                   | `checked`               | resolve and policy                                                 | every policy rule passes (section 4)                                                                                                                                                                   |
| `proposed`                   | `rejected_policy`       | resolve and policy                                                 | a policy rule fails; the reason is stored                                                                                                                                                              |
| `checked`                    | `quoted`                | venue quote and build                                              | decode matches: `to` among the venue's declared contracts, recipient is the agent's own wallet (or the confirmed send target), amounts match, minimum out at least the policy's, deadline at most 60 s |
| `checked`                    | `failed_check`          | venue quote and build                                              | no route, venue down, or decode mismatch                                                                                                                                                               |
| `quoted`                     | `assessed`              | risk check                                                         | token verified, or every risk source passes                                                                                                                                                            |
| `quoted`                     | `risk_blocked`          | risk check                                                         | a hard flag, or sources down for an unknown token                                                                                                                                                      |
| `assessed`                   | `simulated`             | `eth_simulateV1` with transfer tracing                             | net balance changes match the request; no other outflow or approval                                                                                                                                    |
| `assessed`                   | `failed_check`          | simulation                                                         | reverted, or effects differ                                                                                                                                                                            |
| `simulated`                  | `awaiting_confirmation` | card opened                                                        | not authorized by an order, a rule, the rescue's own tap or the auto mode                                                                                                                              |
| `simulated`                  | `confirmed`             | authorization present                                              | `authorizedBy` names an active order or webhook rule whose bounds hold, or the agent's auto mode and the intent passes section 5's auto test                                                           |
| `awaiting_confirmation`      | `awaiting_confirmation` | tap with a stale quote                                             | quote older than 10 s: re-quote and re-simulate; a minimum out worse by more than 0.5% opens card version n+1                                                                                          |
| `awaiting_confirmation`      | `confirmed`             | tap Confirm, `intent/confirm`                                      | the card version tapped is the current one; the card has not expired                                                                                                                                   |
| `awaiting_confirmation`      | `denied`                | tap Cancel, `intent/deny`                                          |                                                                                                                                                                                                        |
| `awaiting_confirmation`      | `expired`               | card timer                                                         | 60 s for trades; 10 min for sends, DeFi, bridges, rescue, identity                                                                                                                                     |
| any state before `executing` | `cancelled`             | `intent/cancel`, freeze, engine stopping                           | not yet signed                                                                                                                                                                                         |
| `confirmed`                  | `paper_filled`          | paper mode                                                         | the agent is in paper mode                                                                                                                                                                             |
| `confirmed`                  | `executing`             | wallet queue takes it                                              | the agent is live; the confirmation record exists and is unexpired; the policy still passes (rechecked)                                                                                                |
| `executing`                  | `included`              | every step's receipt seen                                          | every receipt has status 1                                                                                                                                                                             |
| `executing`                  | `failed_onchain`        | a step's receipt has status 0, or a step was cancelled (section 6) | later steps are not sent                                                                                                                                                                               |
| `executing`                  | `unknown_after_send`    | startup finds a sent step with no known fate                       |                                                                                                                                                                                                        |
| `included`                   | `finalized`             | finality                                                           | the last step's block is final; a reorg before that moves the intent back to `executing`                                                                                                               |
| `finalized`                  | `reconciled`            | reconciliation                                                     | fills decoded and compared with the simulation; a difference above 1% raises an alarm notice but still reconciles                                                                                      |

Nothing leaves a terminal state. A freeze never interrupts `executing`: a running transaction is
finished, never cut in half.

<a id="section-4"></a>

## 4. Policy reasons

The reason stored with `rejected_policy` is one of:

| Reason                 | When                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `frozen`               | The agent or the install is frozen                                                                                                         |
| `paper_only`           | A live-only action (a send, a CEX order, identity) while in paper mode                                                                     |
| `per_trade_cap`        | USD value above the per-trade cap                                                                                                          |
| `ceiling`              | Above the wallet's Privy policy, which only the owner can raise ([decision 0085](../DECISIONS.md#d0085), spec 5)                           |
| `daily_cap`            | The rolling 24 hours would pass the cap ([decision 0046](../DECISIONS.md#d0046))                                                           |
| `gas_reserve`          | The wallet would drop below its reserve ([decision 0045](../DECISIONS.md#d0045))                                                           |
| `slippage`             | Requested slippage above the agent's maximum                                                                                               |
| `price_impact`         | Quoted impact above the maximum (checked after quoting; the intent moves to `failed_check` with this reason)                               |
| `tax`                  | Token tax above the maximum                                                                                                                |
| `venue_off`            | The venue is not allowed for this agent                                                                                                    |
| `token_denied`         | The token is on the deny list, or not on a set allow list                                                                                  |
| `send_level`           | The send target is not allowed at the current send level                                                                                   |
| `unsaved_address`      | The send target is neither the rescue address nor a saved address ([decision 0091](../DECISIONS.md#d0091)); saving one needs the owner key |
| `outside_content_send` | A send or bridge proposed in a turn with the outside-content mark, to an address not in the address book                                   |
| `health_factor`        | A borrow or withdraw would leave the health factor below the minimum                                                                       |
| `no_price`             | No USD value could be found ([decision 0059](../DECISIONS.md#d0059))                                                                       |

Risk reasons for `risk_blocked`: `honeypot`, `cannot_sell`, `hidden_owner`, `high_tax`,
`low_liquidity`, `sources_down`, `blacklisted`.

Check reasons for `failed_check`: `no_route`, `venue_down`, `decode_mismatch`,
`simulation_reverted`, `effects_differ`, `price_impact`.

<a id="section-5"></a>

## 5. Kinds with special paths

- **Auto order fills** start with `authorizedBy: { order }` and skip `awaiting_confirmation`. Every
  fill runs policy and risk again; a fill that fails is skipped and reported, and the order stays
  active unless its own rules end it ([ARCHITECTURE.md section 9](../ARCHITECTURE.md#section-9)).
- **Webhook rule fills** work the same way with `authorizedBy: { webhookRule, alertId }`.
- **Auto mode** ([decision 0088](../DECISIONS.md#d0088)): an intent gets
  `authorizedBy: { approvalMode: "auto", modeVersion }` and skips `awaiting_confirmation` only when
  all of these hold at `simulated`: the agent's mode is `auto`; the kind is `swap`, `buy`, `sell`,
  or a `lend` or `stake` move inside the agent's own positions; it fits the per-trade and
  rolling-day caps; any approval goes to a registry spender; the proposing turn carries no
  outside-content mark; and the proposer is the agent runtime, not an MCP client. Anything else
  opens a card. A receipt is sent when it settles.
- **Rescue** ([decision 0044](../DECISIONS.md#d0044)): one intent, one card, one step per token per
  agent wallet, sent to the rescue address. It works while frozen and at every send level. Its card
  expires after 10 minutes. A step that fails is retried up to 3 times, each time only after the
  failed transaction is final and a new simulation passes; the intent reconciles with every step's
  outcome.
- **Bridges** ([decision 0067](../DECISIONS.md#d0067)) end in `reconciled` when the source
  transaction is final and the bridge reports delivery, or after 2 hours with the delivery marked
  unknown and a notice.
- **Identity registration** ([decision 0071](../DECISIONS.md#d0071)) is a single step to the
  ERC-8004 registry.
- **Token launch** ([decision 0082](../DECISIONS.md#d0082)): the image and metadata are uploaded and
  pinned through the launchpad's own API first; the intent waits in `quoted` until the launchpad
  reports the pin (a gateway read before that can break the image for good). Then the create
  transaction, and the first buy when asked, run as steps of one intent.
- **CEX orders** run through the Binance plugin: no transaction steps; `executing` means the order
  was sent, `included` that it was accepted, `finalized` that it filled or ended, and `reconciled`
  that the plugin's account reads agree.

<a id="section-6"></a>

## 6. Transaction records

Each step has a transaction record with its own state:

| State        | Meaning                                                     |
| ------------ | ----------------------------------------------------------- |
| `built`      | Unsigned and decoded                                        |
| `signed`     | Signed; the raw bytes are stored before any send            |
| `sent`       | Accepted by at least one relay                              |
| `included`   | In a block                                                  |
| `final`      | Past finality                                               |
| `reverted`   | Included with status 0                                      |
| `dropped`    | Gone from every relay, and its nonce is still free          |
| `superseded` | Another transaction took its nonce (a speed-up or a cancel) |

Stuck steps ([ARCHITECTURE.md section 7](../ARCHITECTURE.md#section-7)):

1. Not included after 20 blocks: simulate again. Still valid: send the same bytes again.
2. Still valid but not included after 40 blocks: a speed-up, the same transaction with a gas price
   at least 10% higher, signed again at the same nonce. The old record becomes `superseded`.
3. No longer valid: a cancel, a 0-value transfer to the wallet itself at the same nonce with a gas
   price at least 10% higher. The intent ends `failed_onchain` with reason `stuck_cancelled`.

A signature for a speed-up or a cancel is a new signature for the same confirmed intent; the signer
checks it against the same confirmation record.

<a id="section-7"></a>

## 7. After a crash

On startup ([ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24)), before any order resumes:

1. Every step in `signed` is looked up by hash. Found: it continues from what the chain shows. Not
   found and its nonce is free: it is sent again with the same bytes.
2. Not found and its nonce is used by another transaction: the intent moves to `unknown_after_send`,
   and reconciliation reads that nonce's transaction. It is ours (same hash after all): continue. It
   is not ours: the intent ends `failed_onchain` with reason `nonce_taken` and an alarm notice.
3. Nothing is ever signed again for a step until its earlier transaction's fate is known.

<a id="section-8"></a>

## 8. Ledger, pushes and notices

| Transition into                                   | Ledger entry | Push             | Owner notice ([ARCHITECTURE.md section 27](../ARCHITECTURE.md#section-27)) |
| ------------------------------------------------- | ------------ | ---------------- | -------------------------------------------------------------------------- |
| `proposed`                                        | ✓            | `intent/created` |                                                                            |
| `awaiting_confirmation`                           | ✓            | `card/opened`    | The card itself                                                            |
| `confirmed`, `denied`, `expired`, `cancelled`     | ✓            | `card/closed`    | The card becomes a receipt                                                 |
| `rejected_policy`, `risk_blocked`, `failed_check` | ✓            | `intent/changed` | Only for auto order and webhook fills (skipped fill)                       |
| `executing`, each step `sent`                     | ✓            | `intent/changed` |                                                                            |
| `reconciled`, `paper_filled`                      | ✓            | `intent/changed` | Every fill                                                                 |
| `failed_onchain`, `unknown_after_send`            | ✓            | `intent/changed` | Always                                                                     |

Every other transition pushes `intent/changed` without a ledger entry. The ledger entry records the
state, who or what caused it (surface, device or token), and the hashes involved.

<a id="section-9"></a>

## 9. Concurrency

- One intent is moved by one worker at a time: the intent's queue (`intent:<id>`).
- Signing and sending go through the wallet queue (`wallet:<account>`, width 1), which owns the
  nonce ([rule 6](../ARCHITECTURE.md#rule-6)).
- Every state write carries the version read before it (`version` column); a stale write fails and
  the worker reloads.
- A card's timer and a tap race safely: the first committed write wins, and the loser sees a
  terminal state.

<a id="section-10"></a>

## 10. Invariants

Property tests (fast-check) hold these for every generated history:

1. No transition leaves a terminal state.
2. Every signed transaction has a confirmation record (or an `authorizedBy` that was valid at
   signing) whose intent hash matches its step.
3. A paper intent never reaches `executing`.
4. The amount sent never exceeds the amount on the confirmed card version.
5. A recipient is always the agent's own wallet, except a send, bridge or rescue to its confirmed
   target.
6. Two steps never hold the same nonce in `signed` or `sent` for one wallet, except a step and its
   `superseded` predecessor.
7. Every terminal state has exactly one ledger entry, and the ledger's hash chain verifies.
8. An auto-authorized intent is never a send, withdrawal, bridge, launch or new-spender approval,
   never exceeds a cap, and never comes from an outside-content turn or an MCP client.
9. A send's target is always the rescue address or a saved address
   ([decision 0091](../DECISIONS.md#d0091)).
