# 0176. An agent's tools act only for their own agent

Status: Amended by 0177

Accepted by the owner on 2026-10-12.

## Context

[Spec 8](../specs/runtime.md) section 5.2 says the runtime fills the agent and the wallet of each
tool call, the model gives the terms and its reason, and a wallet outside the agent's own is
refused. The first tools (`portfolio`, `token_info`, `token_risk`, `quote`, `orders`, `tx_status`,
`swap`, `buy`, `sell`, `order_create` and `order_cancel`) call operations of
[spec 1](../specs/protocol.md) that take an agent and an optional wallet, or an id of an intent or
an order of any agent. The runtime holds one connection for every agent of the install. Some cases
are left open:

- **The wallet.** Spec 1's requests take `wallet?`, and absent means the agent's default wallet:
  its oldest wallet not archived. The runtime does not know an agent's wallets without another call.
- **Ids of other agents.** `intent/get`, `order/get` and `order/cancel` answer for any agent's id,
  and the runtime's token may call them for all.
- **Names chosen by a token's deployer.** Section 5.4 makes `token_info` of an unlisted token
  outside content, and says every other tool shows an unlisted token by its address and the words
  "unlisted token". Portfolios, intents and order lists carry each asset's symbol and name.
- **A proposal's answer.** Section 6.1 makes a proposal with no answer an unknown outcome, never
  sent again. A failed call can also mean the engine answered with a refusal, which is certain.
- **An auto order's shape.** A tool's arguments are an object at the root for every provider, and
  `order/create` takes a union of six kinds.

## Decision

- **No agent or wallet from the model.** Each tool's arguments are the operation's request without
  `agent`, `wallet` and, for `swap`, `buy` and `sell`, `kind`: the protocol's terms schemas
  (`swapTermsSchema`, `buyTermsSchema`, `sellTermsSchema`, `orderTermsSchema`), strict, so a call
  that names an agent or a wallet fails its check and never reaches the engine. The runtime names
  its turn's agent in every call and names no wallet, so the engine acts from that agent's default
  wallet, the rule spec 1 already gives. Choosing among an agent's several wallets is a later
  change to these schemas.
- **Its own ids only.** `tx_status` reads an intent and answers "This agent has no intent ..." when
  the intent is another agent's. `order_cancel` reads the order first and cancels only its own
  agent's, with the call's key as its idempotency key.
- **Unlisted tokens.** Every result but `token_info` replaces the symbol and name of an asset the
  registry does not list with "unlisted token", and drops its logo; `token_info` of an unlisted
  token shows them, and its result is outside content.
- **Results.** A read answers the engine's JSON, amounts as decimal strings of base units. A
  proposal answers one sentence: the intent's or order's id and that it waits for the owner's
  confirmation, or the state and reason of an intent the engine refused by its checks, which is an
  error result. A failed read or control call answers its code and the engine's message.
- **Certain and uncertain refusals.** A propose call that the engine refused with its own error
  code is an error result, and the turn ends with the refusal's status line. The client's own
  failures and timeouts, and the codes of the `auth`, `engine`, `internal` and `runtime` areas and
  `protocol.version`, `protocol.bad_frame` and `protocol.not_open` (which can also arrive when the
  engine closed the connection with the call in flight) leave the outcome unknown: the tool throws,
  and the loop never sends the proposal again.
- **Auto orders.** `order_create` takes `{ order }`, the order's terms under one field, so the
  union sits below an object root. An auto order carries no reason: spec 1's order request has no
  field for one.

## Consequences

- A model, or text that steers it, cannot move another agent's funds, read another agent's
  intents or cancel another agent's orders through the tools.
- A field the protocol adds to a request reaches the tool's schema from the same field list.
- A proposal the engine could not judge is never taken as refused, so it is never proposed again
  by the model in the same belief.
- An agent with several wallets trades from its default one until a tool takes a wallet of its own
  agent.

## Alternatives

- **Fill the wallet in the runtime.** Only `agent/list` names an agent's default wallet, so each
  proposal would make one more call that can fail, to send what the engine decides anyway.
  Rejected.
- **A `wallet` field checked against the agent's wallets.** The model would choose a wallet the
  owner did not name, and the check needs the list each time. Rejected until an owner asks for it.
- **Take every failed proposal as refused.** A call cut by a closed connection may have reached
  the engine; taking it as refused invites a second proposal of the same trade. Rejected.
- **The intent's JSON in a proposal's answer.** It repeats what the card shows and carries the
  names of unlisted tokens; the next turn reads the outcome from the settle message. Rejected.
