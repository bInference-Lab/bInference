# 0321. The rescue address joins a destination's bridge rules once it holds no code on either chain

Status: Accepted

Accepted by the owner on 2026-11-01 ("write at change time, pay only after the wait"), with the
owner's ruling of the same day: the agent adds the rescue address to each destination chain's
bridge rule once decision 0318's plain-wallet check passes, and tells the owner.

Amends [decision 0313](0313-a-saved-address-is-payable-only-on-the-chain-it-was-saved-for.md).

## Context

[Decision 0313](0313-a-saved-address-is-payable-only-on-the-chain-it-was-saved-for.md) lets a
bridge pay the rescue address on a destination only where the owner saved it for that chain too,
"until decision 0297's plain-wallet check is built". [Decision 0318](0318-a-bridge-pays-the-rescue-address-only-where-it-holds-no-code-and-never-a-token.md)
built the check: the rescue address holds no code on its own chain and none on the destination, a
delegation counting as code. The engine reads it before each bridge card and again at the wallet
queue, so a ceiling that lists the rescue address on a destination is a bound, never a promise
that a bridge may pay it.

Four facts shape where and when the address joins:

- Every write of a ceiling works out who its bridge rules pay from the accounts the engine names
  (decision 0313). A result the engine does not keep would be lost at the next write, such as an
  address saved on BNB Smart Chain.
- A change of recipients rewrites the bridge rules a ceiling holds and never adds one; a change
  signed ahead only narrows them. The owner key is at hand only while the owner makes a change.
- A destination's rules list at most 100 addresses (decision 0302).
- Each agent's wallets have ceilings of their own, and an owner key's write covers one agent's
  wallets, or every wallet for a rescue address change.

## Decision

- **Per agent and destination.** On each destination chain whose bridge rules an agent's ceiling
  holds, because the agent saved an address there, its writes list the rescue address too, once
  the check passed there for that agent. It joins after the saved addresses and only while they
  leave room: it never displaces one, and once listed it counts against the 100, which the
  address book shows from the same standing for `address/add` and `address/list`. A destination
  with no saved address gets no rule from the rescue address alone, and a chain where the agent
  saved the rescue address itself is paid as that entry and not checked.
- **What is kept.** `safety.rescue_reach` keeps, per agent and destination, where each rescue
  address stands, as last told the owner: `joined` (listed, in effect), `waiting` (listed, waiting
  for its time), `room` (passed, no room), or left out for `code`, `unread` or `kind` (a chain of
  another kind). It is kept only from what the write's read-back shows custody holds, so after a
  refusal part way the engine believes what custody holds; a change custody refuses keeps
  nothing. A standing counts only for the rescue address in effect or the one that waits. Owner
  key writes run one at a time, and each replaces only its own agents' standings.
- **When the check runs.** With the owner key, before the write, only for the agents the write
  covers, on the destinations their rules serve: at a rescue address change, for every agent, the
  new address read afresh and the address in effect where its standing does not list it; at a save
  for a destination and at `ceiling set`, for that agent, every rescue address its standing does
  not list there. The write that gives a chain its first bridge rule is such a write. A listed
  standing stays until the rescue address changes; the reads of decision 0318 before each card and
  at the queue still refuse a bridge to an address that gained code. Writes that check nothing, such
  as a save on BNB Smart Chain or a new wallet, list only what the agent's standings already list.
- **A rescue address change.** The new address joins the destination rules at once, beside the
  old one, as decision 0110 lists it in the send rules; the engine pays it only once it takes
  effect. Every owner key write first sends a change whose time came, and the change signed for
  that time takes the old address out of every destination's rules when it is sent, never
  earlier; the one signed for a cancel takes the new address out. A write that changes what a
  bridge rule lists while a change waits, `ceiling set` included, signs those changes again, as
  `address/add` does.
- **Told once.** Each agent's write journals and announces with its ceiling change the standings
  of that agent that changed: `notice.rescueBridged` where its rules now list a rescue address,
  saying for one that waits that bridges may pay it from its time; when that time comes, the path
  that sends the change tells once that bridges may now pay it. `notice.rescueNotBridged` names
  each chain the address stays out of and why, once per new reason, with the step: save an address
  the owner controls there, or make room.
- **Restore and rebuild.** A restore carries `rescue_reach` with the rescue addresses it belongs
  to, the live install's, as it carries the rescue rules, so the next write lists the same
  accounts. A rebuild keeps none, as it keeps no saved address: when the owner saves addresses for
  a destination again, the check runs and the rule comes back the same.
- **Role wallets.** A bridge wallet's ceiling holds no deposit with a bound recipient (decision
  0307), so it never pays the rescue address on a destination. A launch wallet's ceiling holds the
  main wallet rules, bridge rules among them, and lists the rescue address as a main wallet does.

## Consequences

- An owner whose rescue address is a plain wallet no longer saves it per destination: saving any
  address for a destination brings the rescue address into that agent's rules.
- An owner whose rescue address holds code, or a delegation, still saves an address they control
  on the destination, as decision 0313 asked.
- A save for a destination and `ceiling set` cost up to two node reads per destination where the
  agent's standing does not list the rescue address; a save on BNB Smart Chain reads nothing.
- The 100th address on a destination is refused while the rescue address fills a place there.

## Alternatives

- **Read the check at every write.** A save on BNB Smart Chain would read every destination, and
  a node that does not answer would take the address out and put it back. The card and queue
  reads already guard each bridge.
- **One standing for the whole install.** A pass found in one agent's write would join other
  agents' rules in writes that announce nothing for them.
- **The rescue address makes a destination's rules alone.** A ceiling would gain rules on chains
  the owner never chose to bridge to.
- **The new address joins only when it takes effect.** That needs a change signed ahead that adds
  a payee, and custody's signed changes only narrow, so a change signed earlier never pays anyone
  new.
- **Keep the check's result nowhere and read the ceiling.** A saved entry and the rescue address
  can be the same account on a destination, so the ceiling cannot tell which one listed it.
