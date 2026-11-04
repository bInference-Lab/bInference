---
title: .bnb names and agent identity
description: Send to a .bnb name, and register your agent's on-chain identity in the ERC-8004 identity registry.
---

## Send to a .bnb name

A send may name a SPACE ID name on BNB Smart Chain, such as `alice.bnb`, in place of an address. The
name must point to an address you already saved in the
[address book](/guides/sends-and-bridges/#the-address-book), or to your rescue address. The address
book keeps only the address, never the name.

binference reads the name twice:

1. **When the card opens.** The card shows the name and the address it points to now, and when it
   was read. When that address's reverse record names another name, the card warns you.
2. **Before it signs.** If the name points elsewhere by then, nothing is signed and you get the
   [`nameMoved`](/reference/notices/#namemoved) notice. Check the name, then propose the send again.

binference refuses a name that:

- points nowhere, or has expired; a name in its grace period after expiry counts as expired
- points to a contract

A name may point to a smart-account wallet: an address whose only code is an EIP-7702 delegation to
a wallet program. The card then says so. A send to a name, like every send, always shows a card.

MCP clients can read a name with the `binference_resolve_name` tool.

## Agent identity

You can give an agent an entry in the ERC-8004 identity registry on BNB Smart Chain, so others can
find it and know which wallet trades for it. It is opt-in, one per agent, and only you start it.

```sh
binference agent identity --description "Trades BNB memes for its owner"
```

The command:

1. Shows the identity if the agent has one.
2. Otherwise asks for your owner key and adds the registry's one call to the main wallet's ceiling.
3. Opens the card that registers the agent. Confirm it; auto mode never does.

The agent must be live. The description is 1 to 280 characters and stays on chain for good.

### What it publishes

The registration file is stored on chain, in the registry, as a data URI. It holds:

- the agent's name and your description
- the main wallet that registers it
- binference's version

It never lists the launch wallet or the bridge wallet.

### What binference checks

- The agent and MCP clients cannot start a registration (`intent.owner_only`).
- An agent whose wallet already holds an identity is refused (`intent.identity_exists`), and so is a
  second registration while one runs (`intent.identity_pending`).
- binference checks the registry's version before it signs, and reads the registration back once it
  lands. If what landed is not what the card showed, it stores no identity and sends the
  [`identityMismatch`](/reference/notices/#identitymismatch) notice.

## See also

- [Commands](/reference/commands/) for `agent identity` and `address add`.
- [Sends and bridges](/guides/sends-and-bridges/) for the address book.
