# Spec 6: the intent state machine

Status: accepted on 2026-10-06 ([decision 0093](../DECISIONS.md#d0093)), amended by decisions
[0099](../DECISIONS.md#d0099), [0100](../DECISIONS.md#d0100), [0101](../DECISIONS.md#d0101),
[0102](../DECISIONS.md#d0102), [0103](../DECISIONS.md#d0103), [0109](../DECISIONS.md#d0109),
[0115](../DECISIONS.md#d0115), [0116](../DECISIONS.md#d0116), [0120](../DECISIONS.md#d0120) and 0121
to 0126 ([0121](../DECISIONS.md#d0121), [0122](../DECISIONS.md#d0122), [0123](../DECISIONS.md#d0123),
[0124](../DECISIONS.md#d0124), [0125](../DECISIONS.md#d0125), [0126](../DECISIONS.md#d0126)),
[0127](../DECISIONS.md#d0127), [0128](../DECISIONS.md#d0128) and 0143 to 0146
([0143](../DECISIONS.md#d0143), [0144](../DECISIONS.md#d0144), [0145](../DECISIONS.md#d0145),
[0146](../DECISIONS.md#d0146)).

An intent is one action the owner may confirm: a swap, a send, a lend, a rescue, an unfreeze, an
order fill. It
moves through fixed states under one owner, the module `engine/src/intents/state-machine.ts`. No
other code writes an intent's state ([ENGINEERING.md principle 2](../ENGINEERING.md#section-1)).

<a id="section-1"></a>

## 1. Parts of an intent

- **The request**: what was asked (protocol spec 8.1), stored as given.
- **The plan**: one or more steps, each an unsigned transaction with its decoded effect. A swap with
  an approval has two steps: an exact approval, then the swap. A rescue has one step per token per
  wallet.
- **The card**: what the owner sees and confirms, in versions. A new quote with worse terms makes a
  new version ([rule 4](../ARCHITECTURE.md#rule-4)). Its terms hash is the SHA-256 of the intent,
  the card version, the request, the quote and the plan: what the card shows and what runs. A
  re-quote within the tolerance at the tap replaces the quote and the plan, and the confirmation
  stores the hash of the new ones, which every signature then carries
  ([decision 0144](../DECISIONS.md#d0144)). An auto grant's hash covers the same documents.
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
| `cancelled`             | Withdrawn before any signature: by the proposer, a freeze, a stop or an unsigned step. Terminal.  |
| `failed_onchain`        | A step reverted, was replaced by a cancel, or was dropped. Terminal.                              |
| `unknown_after_send`    | A step's fate is unknown after a crash; reconciliation is running                                 |

`unknown_after_send` is not terminal: it ends in `reconciled` or `failed_onchain` (section 7).

<a id="section-3"></a>

## 3. Transitions

These rows are the only ways an intent moves. Guards are checked inside the same database
transaction as the write ([ENGINEERING.md section 10](../ENGINEERING.md#section-10)).

| From                         | To                      | Trigger                                                                              | Guard                                                                                                                                                                                                  |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (none)                       | `proposed`              | `intent/propose`, an order fill, a webhook alert, `safety/rescue`, `safety/unfreeze` | args valid; agent exists and is not archived; a rescue is stored live in either mode ([decision 0100](../DECISIONS.md#d0100)), and so is an unfreeze ([decision 0128](../DECISIONS.md#d0128))          |
| `proposed`                   | `checked`               | resolve and policy                                                                   | every policy rule passes (section 4)                                                                                                                                                                   |
| `proposed`                   | `rejected_policy`       | resolve and policy                                                                   | a policy rule fails; the reason is stored                                                                                                                                                              |
| `checked`                    | `quoted`                | venue quote and build                                                                | decode matches: `to` among the venue's declared contracts, recipient is the agent's own wallet (or the confirmed send target), amounts match, minimum out at least the policy's, deadline at most 60 s |
| `checked`                    | `failed_check`          | venue quote and build                                                                | no route, venue down, or decode mismatch                                                                                                                                                               |
| `quoted`                     | `assessed`              | risk check                                                                           | token verified, or every risk source passes ([decision 0112](../DECISIONS.md#d0112))                                                                                                                   |
| `quoted`                     | `risk_blocked`          | risk check                                                                           | a hard flag, or sources down for an unknown token                                                                                                                                                      |
| `quoted`                     | `failed_check`          | simulation of the chosen route                                                       | it reverted, or its effects differ; the risk check never runs on it ([decision 0145](../DECISIONS.md#d0145))                                                                                           |
| `assessed`                   | `simulated`             | `eth_simulateV1` with transfer tracing                                               | net balance changes match the request; no other outflow or approval. A paper sale of a token no simulation can hold passes as an estimate ([decision 0114](../DECISIONS.md#d0114))                     |
| `assessed`                   | `failed_check`          | simulation                                                                           | reverted, or effects differ                                                                                                                                                                            |
| `simulated`                  | `awaiting_confirmation` | card opened                                                                          | not authorized by an order, a rule, the rescue's own tap or the auto mode                                                                                                                              |
| `simulated`                  | `confirmed`             | authorization present                                                                | `authorizedBy` names an active order or webhook rule whose bounds hold, or the agent's auto mode and the intent passes section 5's auto test                                                           |
| `awaiting_confirmation`      | `awaiting_confirmation` | tap with a stale quote                                                               | quote older than 10 s: re-quote and re-simulate; a minimum out worse by more than 0.5% opens card version n+1                                                                                          |
| `awaiting_confirmation`      | `confirmed`             | tap Confirm, `intent/confirm`                                                        | the card version tapped is the current one; the card has not expired; the rolling cap still holds ([decision 0136](../DECISIONS.md#d0136))                                                             |
| `awaiting_confirmation`      | `denied`                | tap Cancel, `intent/deny`                                                            |                                                                                                                                                                                                        |
| `awaiting_confirmation`      | `expired`               | card timer                                                                           | 60 s for trades and CEX orders; 10 min for sends, DeFi, bridges, rescue, unfreezes, identity, token launches and approval revokes                                                                      |
| `confirmed`                  | `expired`               | the executor finds its authorization ran out                                         | the confirmation or the auto grant expired before a queue took it, so nothing was signed; the owner gets `notice.confirmationLapsed` ([decision 0120](../DECISIONS.md#d0120))                          |
| `confirmed`                  | `awaiting_confirmation` | the fee wait outlasted the confirmation                                              | a tapped intent held while the fee per gas was above the cap, its confirmation run out: card version n+1, and `notice.feeAboveCap` ([decision 0143](../DECISIONS.md#d0143))                            |
| any state before `executing` | `cancelled`             | `intent/cancel`, freeze, engine stopping                                             | not yet signed; a freeze leaves a rescue alone ([decision 0099](../DECISIONS.md#d0099))                                                                                                                |
| `confirmed`                  | `paper_filled`          | paper mode                                                                           | a paper intent, which a rescue never is ([decision 0100](../DECISIONS.md#d0100))                                                                                                                       |
| `confirmed`                  | `executing`             | wallet queue takes it                                                                | the agent is live, or the intent is a rescue; the confirmation record exists and is unexpired; the policy still passes (rechecked)                                                                     |
| `confirmed`                  | `reconciled`            | the unfreeze is written                                                              | an unfreeze: the agents its card named, and the install for a whole-install unfreeze, are unfrozen in the same write ([decision 0128](../DECISIONS.md#d0128))                                          |
| `executing`                  | `included`              | every step's receipt seen                                                            | every receipt has status 1                                                                                                                                                                             |
| `executing`                  | `failed_onchain`        | a step's receipt has status 0, or a step was cancelled (section 6)                   | the reason `reverted` or `stuck_cancelled` is stored; later steps are not sent                                                                                                                         |
| `executing`                  | `unknown_after_send`    | startup finds a sent step with no known fate                                         |                                                                                                                                                                                                        |
| `unknown_after_send`         | `executing`             | reconciliation finds the step's transaction                                          | the transaction at its nonce is ours (section 7)                                                                                                                                                       |
| `executing`                  | `failed_onchain`        | a stuck step is dropped (section 6)                                                  | the reason `stuck_dropped` is stored; the owner gets `notice.stepDropped`, or `notice.stepDroppedPartWay` once an earlier step landed ([decision 0115](../DECISIONS.md#d0115))                         |
| `unknown_after_send`         | `failed_onchain`        | reconciliation finds another transaction                                             | another transaction used the step's nonce (section 7); the reason `nonce_taken` is stored, with an alarm notice                                                                                        |
| `executing`                  | `cancelled`             | a step taken was never signed, and nothing will sign it                              | no step was signed before it ([decision 0109](../DECISIONS.md#d0109)); the owner gets `notice.notSigned`                                                                                               |
| `executing`                  | `failed_onchain`        | a step taken was never signed, and nothing will sign it                              | an earlier step landed; the reason `step_unsent` is stored and the owner gets `notice.stepUnsent` ([decision 0109](../DECISIONS.md#d0109)); a rescue retries instead                                   |
| `included`                   | `finalized`             | finality                                                                             | the last step's block is final                                                                                                                                                                         |
| `included`                   | `executing`             | a reorg removes a step's block before it is final                                    |                                                                                                                                                                                                        |
| `finalized`                  | `reconciled`            | reconciliation                                                                       | fills decoded and compared with the simulation; a difference above 1% raises an alarm notice but still reconciles                                                                                      |

Nothing leaves a terminal state. A freeze never interrupts `executing`: a running transaction is
finished, never cut in half. A freeze never cancels a rescue either (section 5).

<a id="section-4"></a>

## 4. Policy reasons

The reason stored with `rejected_policy` is one of:

| Reason                 | When                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frozen`               | The agent or the install is frozen                                                                                                                                                                              |
| `paper_only`           | A live-only action (a send, a bridge, a CEX order, identity) while in paper mode. Never a rescue, which runs live in either mode ([decision 0100](../DECISIONS.md#d0100))                                       |
| `per_trade_cap`        | USD value above the per-trade cap                                                                                                                                                                               |
| `ceiling`              | Above the wallet's Privy policy, which only the owner can raise ([decision 0085](../DECISIONS.md#d0085), spec 5)                                                                                                |
| `daily_cap`            | The rolling 24 hours would pass the cap ([decision 0046](../DECISIONS.md#d0046)), each confirmation counted at its judged value ([decision 0136](../DECISIONS.md#d0136))                                        |
| `gas_reserve`          | The wallet would drop below its reserve ([decision 0045](../DECISIONS.md#d0045))                                                                                                                                |
| `slippage`             | Requested slippage above the agent's maximum                                                                                                                                                                    |
| `price_impact`         | Quoted impact above the maximum (checked after quoting; the intent moves to `failed_check` with this reason)                                                                                                    |
| `tax`                  | Token tax above the maximum. No source gives the policy a token's tax, so no intent stores this reason yet: the risk step measures the tax and refuses with `high_tax` ([decision 0113](../DECISIONS.md#d0113)) |
| `venue_off`            | The venue is not allowed for this agent                                                                                                                                                                         |
| `token_denied`         | The intent buys or receives a token on the deny list, or moves one missing from a set allow list. Selling a denied token passes, but always opens a card ([decision 0101](../DECISIONS.md#d0101))               |
| `send_level`           | The send target is not allowed at the current send level                                                                                                                                                        |
| `unsaved_address`      | The send target is neither the rescue address nor a saved address ([decision 0091](../DECISIONS.md#d0091)); saving one needs the owner key                                                                      |
| `outside_content_send` | A send or bridge proposed in a turn with the outside-content mark, to an address not in the address book                                                                                                        |
| `health_factor`        | A borrow or withdraw would leave the health factor below the minimum                                                                                                                                            |
| `no_price`             | No USD value could be found ([decision 0059](../DECISIONS.md#d0059))                                                                                                                                            |

Risk reasons for `risk_blocked`: `honeypot`, `cannot_sell`, `hidden_owner`, `high_tax`,
`low_liquidity`, `sources_down`, `blacklisted`.

Check reasons for `failed_check`: `no_route`, `venue_down`, `decode_mismatch`,
`simulation_reverted`, `effects_differ`, `price_impact`.

Failure reasons for `failed_onchain`: `reverted` (a step's receipt has status 0), `stuck_cancelled`
and `stuck_dropped` (section 6, [decision 0115](../DECISIONS.md#d0115)), `nonce_taken` (section 7)
and `step_unsent` (a step never signed after an earlier one landed,
[decision 0109](../DECISIONS.md#d0109)).

<a id="section-5"></a>

## 5. Kinds with special paths

- **Auto order fills** start with `authorizedBy: { order }` and skip `awaiting_confirmation`. Every
  fill runs policy and risk again; a fill that fails is skipped and reported, and the order stays
  active unless its own rules end it ([ARCHITECTURE.md section 9](../ARCHITECTURE.md#section-9)).
- **Webhook rule fills** work the same way with `authorizedBy: { webhookRule, alertId }`.
- **Auto mode** ([decision 0088](../DECISIONS.md#d0088)): an intent gets
  `authorizedBy: { approvalMode: "auto", modeVersion }` and skips `awaiting_confirmation` only when
  all of these hold at `simulated`: the agent's mode is `auto`; the engine is not locked, or the
  intent is a paper one ([decision 0103](../DECISIONS.md#d0103)); the kind is `swap`,
  `buy`, `sell`, or a `lend` or `stake` move inside the agent's own positions; it sells no token on
  the deny list ([decision 0101](../DECISIONS.md#d0101)); it fits the per-trade and rolling-day
  caps; its fee per gas is at most the chain's network fee cap
  ([decision 0102](../DECISIONS.md#d0102)); any approval goes to a registry spender; the proposing
  turn carries no outside-content mark; and the proposer is the agent runtime, not an MCP client.
  Only the agent runtime the engine runs in its own process can say its turn read no outside
  content; any other proposal of the agent runtime carries the mark, so no client can clear it.
  Anything else opens a card. A receipt is sent when it settles. The test checks these conditions in
  this order and names the first that fails: `manual` (the agent is in manual mode), `locked` (the
  engine is locked and the intent is live), `send`, `kind`, `deniedToken` (it sells a token on the
  deny list), `overCap`, `overFeeCap` (its fee per gas is above the network fee cap), `spender` (an
  approval to a spender outside the registry), `outside` or `mcp`. The card shows each code but
  `manual` with its `autoAsks` message (spec 4, section 3.4).
- **A token on the deny list** ([decision 0101](../DECISIONS.md#d0101)) may leave the wallet, by a
  sale, a swap or a send, but never enter it. The policy passes such an intent with the mark
  `sellsDeniedToken`, which the auto test reads, so it always opens a card.
- **The network fee cap** ([decision 0102](../DECISIONS.md#d0102)) is the most fee per gas a
  transaction pays without a tap: `chains.maxFeePerGasGwei` (spec 2), 1 gwei on BSC by default. The
  fee per gas is read when the steps are built. Above the cap, the intent is not refused: it opens a
  card, in either mode. No card shows a fee per gas yet, so no transaction is signed above the cap,
  tapped or not ([decision 0143](../DECISIONS.md#d0143)): the fee is read again when the queue takes
  the intent, at each later step and at each speed-up or cancel. Above the cap at the take, the
  intent stays `confirmed` and the queue tries again each block until the fee falls. A tapped
  intent whose confirmation runs out during that wait gets the next card version, for a new
  confirmation, and the owner gets `notice.feeAboveCap`; an auto intent expires (section 7, item
  5). A later step above the cap ends the intent as a step never signed (section 3). The card's
  fees line (spec 4, section 3) will show the fee per gas; until it does, a tap never raises the
  cap.
- **Rescue** ([decision 0044](../DECISIONS.md#d0044)): one intent, one card, one step per token per
  agent wallet, sent to the rescue address. It works while frozen and at every send level: a freeze
  does not cancel a pending rescue, since it pays only the owner's own rescue address
  ([decision 0099](../DECISIONS.md#d0099)). It moves the real funds in paper mode too: paper mode
  fakes trades, never the rescue. A rescue is stored live whatever the agent's mode, so it never
  fills on paper, and the wallet queue takes it while the agent is in paper mode
  ([decision 0100](../DECISIONS.md#d0100)). Its card expires after 10 minutes. A step that fails is
  retried up to 3 times, each time only after the failed transaction is final and a new simulation
  passes; the intent reconciles with every step's outcome.
  - **What moves:** each wallet on the rescue address's chain sends every token the chain registry
    lists and every asset it holds a live position in, with a balance above zero; no other token is
    looked for ([decision 0121](../DECISIONS.md#d0121)). Its native coin goes last, all of it above
    its agent's gas reserve, which stays to pay the rescue's own fees
    ([decision 0122](../DECISIONS.md#d0122)).
  - **One intent, many wallets:** the intent is stored under the oldest wallet that moves something
    and whose agent is active. Its quote lists every move with the wallet that signs it, and the
    card's terms hash covers them. The first wallet's queue takes the intent; each wallet then sends
    its own steps from its own queue, the wallets one after another. A step stuck at its nonce ends
    its wallet's part only ([decision 0123](../DECISIONS.md#d0123)). Each step, at its first run
    or after a restart, signs only while the address the card confirmed is still the rescue address
    in effect ([decision 0110](../DECISIONS.md#d0110)); once it changed, the rescue sends nothing
    more, reconciles with what landed, and the owner gets `notice.rescueStopped`.
  - **Checks:** each wallet's sends are simulated in order before the card opens. A send that
    fails, moves anything but its own amount out of its wallet, sets an allowance, or lands nothing
    at the rescue address is left out, and the rest go. With nothing left, no rescue is stored
    ([decision 0124](../DECISIONS.md#d0124)).
  - **One at a time:** while a rescue has not ended, `safety/rescue` answers its intent and plans
    nothing ([decision 0125](../DECISIONS.md#d0125)).
  - **Positions:** it reconciles once what each landed send took out of its wallet, the units and
    the gas, has left the positions at average cost, with no gain or loss
    ([decision 0127](../DECISIONS.md#d0127)).
- **Unfreeze** ([decision 0128](../DECISIONS.md#d0128)): one live intent of the owner's, which only
  `safety/unfreeze` stores, under the first agent it unfreezes and that agent's first wallet. Its
  quote names the agents to unfreeze and whether the install's freeze lifts too, so the card's
  terms hash binds them. It has no policy step, quote source, risk check or simulation of its own,
  and no step: it reaches its card at once, which never passes the auto test and lasts 10 minutes.
  On the tap, one write unfreezes what the card named and moves it to `reconciled`; the executor
  never takes it. A freeze cancels it like any unsigned intent.
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
4. Every relay turned the step's bytes away for 60 blocks, each with an answer that says it holds
   none of them, no transaction the step replaced may still sit with a relay, its nonce is still
   free, also by the count a node takes with its pool (`pending`), and no node knows any of the
   step's transactions: the step is recorded `dropped`, which frees its nonce, and the intent ends
   `failed_onchain` with reason `stuck_dropped` ([decision 0115](../DECISIONS.md#d0115)). A step
   no rule can move waits 60 blocks for this, getting the same bytes every 20, before it is handed
   over still `executing`. A step handed over keeps its nonce, so it holds its wallet's queue: it
   gets the same bytes every 20 blocks until a block holds one of its transactions or the drop
   rule drops it, no later step of the wallet signs behind it, and the owner gets
   `notice.walletHeld`. The executor watches a dropped step's transactions for 600 more blocks,
   off the wallet's queue; one that lands after all raises `notice.droppedLanded`, and the intent
   stays `failed_onchain`.

"Simulate again" means preparing the step's draft again on the latest state, whose gas estimate
runs the call there. No speed-up or cancel is signed with a fee per gas above the network fee cap
([decision 0143](../DECISIONS.md#d0143)); the step is handed over instead
([decision 0115](../DECISIONS.md#d0115)). Whichever transaction at a step's nonce lands is the
step's; the store supersedes the others in the same write. A nonce that seems used by another
transaction counts as another's only once a final block holds it and the step's receipts, read
again then, show none of its own, as at recovery (section 7).

A signature for a speed-up or a cancel is a new signature for the same confirmed intent; the signer
checks it against the same confirmation record, and signs a cancel for one minute after that
record expired ([decision 0116](../DECISIONS.md#d0116)). The executor reads the authorization
again right before each later step, speed-up and cancel: an auto grant carries the agent's approval
mode as it stands then, so a switch to manual stops every later signature of the intent, and no
later step or speed-up is signed once the confirmation expired. A later step that nothing
authorizes any more ends the intent as a step never signed; a stuck step waits for the drop rule.

<a id="section-7"></a>

## 7. After a crash

On startup ([ARCHITECTURE.md section 24](../ARCHITECTURE.md#section-24)), before any order resumes:

1. Every step in `signed` is looked up by hash. Found: it continues from what the chain shows. Not
   found and its nonce is free: it is sent again with the same bytes.
2. Not found and its nonce is used by another transaction: the intent moves to `unknown_after_send`,
   and reconciliation reads that nonce's transaction. It is ours (same hash after all): continue. It
   is not ours: the intent ends `failed_onchain` with reason `nonce_taken` and an alarm notice.
3. Nothing is ever signed again for a step until its earlier transaction's fate is known.
4. Recovery never signs, except a rescue's unsent steps. A step with no stored transaction ends the
   intent: `cancelled` when no step was signed, `failed_onchain` with `step_unsent` once an earlier
   step landed, each with an owner notice ([decision 0109](../DECISIONS.md#d0109)). The executor
   ends an intent the same way when a step cannot be signed or stored, custody or the signer fails
   as it signs (`eth_signTransaction` sends nothing), or no node answers as the step is prepared. A rescue left `executing`
   goes on instead: a step a block holds is done, a signed or sent step goes on with its stored
   bytes, and a step with no stored transaction is signed as at its first run while the owner's
   confirmation lasts. Once it has run out, that step fails and the rescue reconciles with what
   landed ([decision 0126](../DECISIONS.md#d0126)). A step whose transactions were dropped ends
   `failed_onchain` with `stuck_dropped`, unless a block holds one of them after all
   ([decision 0115](../DECISIONS.md#d0115)).
5. A `confirmed` live intent whose confirmation or auto grant ran out while the engine was stopped
   or locked moves to `expired`, with `notice.confirmationLapsed`; nothing is signed. One that
   still holds waits for the queue until the engine holds its keys
   ([decision 0120](../DECISIONS.md#d0120)). A running engine does the same for an intent its
   queue refused or left `confirmed` ([decision 0146](../DECISIONS.md#d0146)): one whose authorization ran out while it waited behind the
   wallet's other intents, one whose first step no node could prepare, which the queue tries
   again each block until then, and an auto intent whose fee per gas stayed above the cap. A
   tapped intent that waited for the fee gets a new card version instead
   ([decision 0143](../DECISIONS.md#d0143)).

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

A move to `cancelled` on a step never signed has no card to close; the owner gets
`notice.notSigned` instead ([decision 0109](../DECISIONS.md#d0109)). A move from `confirmed` to
`expired` at recovery has none either; the owner gets `notice.confirmationLapsed`
([decision 0120](../DECISIONS.md#d0120)). A dropped step's notice is
`notice.stepDropped`, or `notice.stepDroppedPartWay` once an earlier step landed
([decision 0115](../DECISIONS.md#d0115)).

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
- One agent's confirmations, by a tap or the auto mode, run one at a time against its rolling cap:
  each reads the confirmations every earlier one left, so two that pass the cap together never both
  land, and a tap that would pass it fails `limit.daily_cap` with its card left open
  ([decision 0136](../DECISIONS.md#d0136)).

<a id="section-10"></a>

## 10. Invariants

Property tests (fast-check) hold these for every generated history:

1. No transition leaves a terminal state.
2. Every signed transaction has a confirmation record (or an `authorizedBy` that was valid at
   signing) whose intent hash matches its step.
3. A paper intent never reaches `executing`, and a rescue is never a paper intent
   ([decision 0100](../DECISIONS.md#d0100)).
4. The amount sent never exceeds the amount on the confirmed card version.
5. A recipient is always the agent's own wallet, except a send, bridge or rescue to its confirmed
   target.
6. Two steps never hold the same nonce in `signed` or `sent` for one wallet, except a step and its
   `superseded` predecessor.
7. Every terminal state has exactly one ledger entry, and the ledger's hash chain verifies.
8. An auto-authorized intent is never a send, withdrawal, bridge, launch or new-spender approval,
   never exceeds a cap, never sells a token on the deny list, never pays a fee per gas above the
   network fee cap, and never comes from an outside-content turn or an MCP client.
9. A send's target is always the rescue address or a saved address
   ([decision 0091](../DECISIONS.md#d0091)).
10. No 24-hour window holds confirmations of one agent in one mode whose values together pass its
    rolling cap ([decision 0136](../DECISIONS.md#d0136)).
