# 0330. A bridge quote with no recipient is priced for the rescue address where it may be paid

Status: Accepted

Accepted by the owner on 2026-11-02.

## Context

The protocol spec gives `bridge/quote` an optional `to`, the recipient a route is priced for, so
the agent can quote a move before it knows where the owner wants it. Every bridge prices a quote
for a recipient: the deposit names one, and some routes pay an account with no code in the
destination's coin. The spec does not say whom a quote with no `to` is priced for.

A bridge pays the rescue address on another chain only where decision
[0318](0318-a-bridge-pays-the-rescue-address-only-where-it-holds-no-code-and-never-a-token.md)
lets it: once its plain-wallet check passed and the agent's bridge rules joined it there
([decision 0321](0321-the-rescue-address-joins-a-destination-s-bridge-rules-once-it-holds-no-code-on-either-chain.md)), or where the owner saved it on that chain as an address of the book.

## Decision

- With no `to`, `bridge/quote` prices the routes for the owner's rescue address on the
  destination when the rescue address may be paid there: its standing in the agent's bridge rules
  on that chain is `joined`, which makes the quote `{ rescue: true }`, or the agent's address book
  saves the same account on that chain, which makes it that entry.
- Otherwise the quote is refused with `address.no_recipient`, before any venue is asked. Its words,
  in English and Chinese, tell the agent to ask the owner which saved address on that chain to use,
  and the `bridge_quote` tool says the same.
- A quote moves nothing and stores nothing. It resolves and checks a bridge as a proposal does, so
  a quote the engine answers is one a proposal with the same recipient could take.

## Consequences

- The agent can quote a bridge from the owner's words alone when the owner's rescue address is
  ready on that chain, and is sent back to the owner otherwise, never to a guessed recipient.
- A rescue address waiting for its time, with no room in a rule, or holding code, is no default
  until it joins; a saved entry for it still is.

## Alternatives

- **Price for the agent's own wallet address there.** A bridge never pays a wallet of the
  install (`address.own_wallet`), so the quote would be for a recipient no proposal can name.
- **Price for the first saved address on that chain.** The owner did not pick it, and the agent
  would read a route for an address the owner may not mean.
- **Refuse every quote without `to`.** The agent would ask the owner even when the rescue address
  is the answer it would give.
