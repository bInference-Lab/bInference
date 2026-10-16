# 0217. A launch wallet trades on launch contracts under a ceiling of its own

Status: Amended by 0218

Accepted by the owner on 2026-10-15.

## Context

A launchpad such as Genius.fun makes a curve contract with each launch
([decision 0212](0212-a-launch-s-own-contracts-come-from-its-launchpad-s-curve-read.md)). No list
of addresses can hold such contracts, so no agent wallet's ceiling allows a call to one, and a live
agent cannot trade on them (`limit.needs_launch_wallet`). The owner decided on 2026-10-14: "Curve
trades use a separate wallet you fund with a small amount, e.g. 0.5 BNB. Its rules allow any launch
curve, so stolen keys could only take what is in it. Your main wallet stays locked to known
contracts."

Privy's policy docs, read on 2026-10-15 ("Overview", "Template variables", "Stateful policies" and
"Ethereum examples", docs.privy.io):

- A rule applies when the request meets every condition it has. A rule may hold no `to` condition:
  `function_name` alone matches "any call to a given function", and the template variables page
  allows an ERC-20 `transfer` by its decoded `transfer.recipient` alone.
- A condition on `function_name.param_name` compares one decoded top-level argument, and
  `{{wallet.address}}` stands for the signing wallet's own address, as the whole value of an `eq`
  or an `in`.
- A rule name holds at most 50 characters and an `in` at most 100 values; an app keeps at most 10
  aggregations, and an aggregation sums the requests of every wallet whose policies name it.
- Privy reads only `to`, `value` and `chain_id` of the transaction itself: no condition can say
  that an `approve` names the contract a later call goes to.

## Decision

- **One launch wallet per agent.** `wallet/create` takes `launch: true`, and
  `binference wallet create --launch` asks for the owner key as any new wallet does
  ([decision 0130](0130-a-new-wallet-needs-the-owner-key-and-its-ceiling-lists-the-saved-addresses.md)).
  An agent with a live launch wallet is refused a second (`wallet.launch_exists`). The wallet is
  stored with the role `launch`.
- **Its ceiling is its own.** It holds every rule the agent's ceiling holds, and on each chain, for
  every launchpad the install runs, a rule per call the launchpad declares on its launch contracts:
  the function by `function_name` with its JSON ABI, on any contract, with each input the
  launchpad pins equal to `{{wallet.address}}` (a launch call that pins none is refused), at most
  the per-transaction cap in native coin, and the chain's 24-hour native cap. When a launchpad
  names a launch contract as a spender, one more rule allows an `approve` with no native coin
  naming any spender, under each capped token's 24-hour cap. This is the one exception to
  [decision 0132](0132-a-ceiling-change-applies-to-every-wallet-of-the-agent.md): a ceiling change
  still reaches every live wallet of the agent, and the launch wallet's launch rules are written
  again with it.
- **Sends go where every wallet's go.** A send from the launch wallet pays only the rescue address
  or an address saved with the owner key (decision 0091), and no ceiling lists the launch wallet as
  a recipient. The owner funds it from outside, such as from the rescue address's wallet, and a
  rescue takes everything back.
- **The 24-hour caps stay as decisions 0149 and 0151 set them.** The launch rules name the same
  aggregations as every ceiling of the install, so the launch wallet's calls count toward the same
  sums. No new number: the owner's funding bounds the wallet.
- **The engine routes a curve trade there and nowhere else.** A live buy or sale of a token a
  launchpad holds on a curve with launch contracts runs from the agent's live launch wallet, as
  does a live sale or swap of a token the registry does not list that the wallet holds, through
  the pools after the token graduated too; an auto order on such a token is held by the launch
  wallet the same way. A request that names its wallet keeps it, and a paper intent, which signs
  nothing, runs from the default wallet. The signer is told the wallet's role and each step's
  launch contracts, read again from the launchpad right before signing, and allows a call to a
  launch contract, or an approval naming one, only from a launch wallet.
- **Going live.** A live agent may add a launchpad with launch contracts to its venues once it has
  a live launch wallet, and an agent whose venues hold one goes live only then; otherwise both
  stay `limit.needs_launch_wallet`.
- **Freeze, rescue and backups cover it** as any wallet of the agent. A rebuilt install adopts a
  launch wallet whose rules are exactly the ones binference builds, and knows it by its launch
  rules.
- **The card names it.** A card of an intent that runs from a launch wallet says so.

## Consequences

- What a stolen engine key, the agent key and the app secret together, can take beyond decision
  0149:
  - From the launch wallet: all it holds. A call named like a declared launch call, sent to a
    contract the thief wrote, can carry the coin, at most the per-transaction cap a call and the
    install's 24-hour native cap a day; an `approve` naming the thief can take any token it holds,
    WBNB, USDT and USDC within their 24-hour approval caps. An allowance granted that way outlives
    the agent key, until a rescue empties the wallet.
  - From the agent's other wallets: nothing more. No ceiling lets them pay the launch wallet, and
    their rules name no launch rule.
  - From the launch wallet, nothing to an address the owner did not save: sends keep decision
    0091's wall.
- What a hostile curve can take while the engine trades honestly: on a buy, what the buy spends,
  at most the per-transaction cap; on a sale, the exact approval of the tokens sold. The minimum
  out, the decode check, the risk step's round trip and the simulation stand before each trade,
  and nothing reaches past the launch wallet.
- The launch rules name no contract, so the launchpads they come from do not narrow them: any
  contract with a function of that name and inputs answers them. The launch wallet holds them from
  the moment it is made, so a live agent adds a launchpad with the 24-hour wait alone. A
  launchpad installed later declares calls the wallet's rules may lack until the owner key changes
  the ceiling; Privy refuses those calls until then.
- Privy cannot tie an approval to the curve the next call reaches, so only the signer and the
  engine check that the spender is the step's launch contract.
- A ceiling with launch rules reads back as a launch wallet's: `readCeiling` says `isLaunch`,
  `isBuiltCeiling` holds for it, and a rule that pins no input, names a contract or a spender, or
  names another chain, fails it.
- The wallets table gains `role`; the protocol's `wallet/create` gains `launch`, `WalletView` and
  `AgentView` name the launch wallet; `wallet.launch_exists` is a new error code; the signer's
  `authorize` request carries the wallet's role and the step's launch contracts; spec 5 sections 4
  and 5.2 say so.

## Alternatives

- **Let the agent's other wallets pay the launch wallet.** A thief would move their funds there and
  out through a launch call, so the main wallet would no longer stay locked to known contracts.
  Rejected: the owner funds the launch wallet from outside.
- **List each curve in the launch wallet's ceiling.** Each launch would need the owner key, and
  `in` holds 100 values. Rejected.
- **A Privy condition set of curves.** Each change needs the owner's signature, as a rule does.
  Rejected for the same reason.
- **Launch rules for the agent's venues only.** They name no contract either way, and a live agent
  could add a launchpad only after an owner-key change. Rejected.
- **No approval rule; sell only what needs none.** Every sale on a Genius.fun curve approves the
  curve first. Rejected.
