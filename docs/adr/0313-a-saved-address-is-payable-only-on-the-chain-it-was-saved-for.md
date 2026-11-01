# 0313. A saved address is payable only on the chain it was saved for

Status: Accepted

Accepted by the owner on 2026-11-01, built on the owner's ruling of 2026-10-30 ("Lock chain and
address": an address saved for Base is never payable by a plain send on BNB Smart Chain, and its
bridge rule alone carries it) and the lead's of 2026-10-31 (split the send rules per chain). With
it the owner ruled that the rescue address is saved per chain until decision 0297's plain-wallet
check lands, that Solana addresses can be saved now, and that a destination save may add a
missing ETH cap, with a notice.

Amends [decision 0302](0302-a-bridge-deposit-binds-its-depositor-recipient-chain-and-tokens-in-one-rule-per-route.md).

## Context

[Decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md)
saves an address for one chain, as a CAIP-10 account, and binds a bridge's recipient and its
destination chain in one rule. [Decision 0302](0302-a-bridge-deposit-binds-its-depositor-recipient-chain-and-tokens-in-one-rule-per-route.md)
built those rules, but kept every bridge recipient among a ceiling's send recipients: the send
rules listed one set of addresses on every chain the ceiling enables. An address the owner saved
for Base was then also payable by a plain send on BNB Smart Chain, where it may belong to no one
the owner knows, such as an exchange's deposit address on one chain only.

[Decision 0298](0298-binference-reads-solana-and-never-signs-on-it.md) gives a Solana address 32
recipient bytes. A deposit on BNB Smart Chain names such a recipient as a `bytes32` input. Privy
compares a `bytes32` input in any case, and its `in` takes a list (seen on its test app, 2026-10-31). No venue in
v1 deposits to Solana from a main wallet: Across serves no route from BNB Smart Chain to Solana,
and Relay names only an order id (decision 0303). A bridge also gives Solana an id of its own
(Across `34268394551451`, Relay `792703809`), unlike an EVM chain, whose EIP-155 id every bridge
uses.

## Decision

- **One list per chain.** A ceiling's addresses are listed per chain. Each enabled chain's send
  rules pay the rescue address and the addresses saved for that chain alone. A destination's
  bridge rules pay the addresses named for it that are still saved for it. The rescue address
  reaches a destination only when it is listed for that destination too: until decision 0297's
  plain-wallet check is built, the owner saves it for that chain as any other address.
- **The engine names accounts.** Custody gets every account a wallet may pay, each with its own
  chain: the rescue address in effect, a new one that waits, and the agent's saved addresses. The
  ceiling adapter turns each into its recipient bytes through its family's codec, and lists it
  under each id the rules bind for its chain: an EVM chain's EIP-155 id. Every write, a change of
  recipients, a change of calls and a new wallet alike, derives each destination's recipients
  from these accounts, so removing an address, or replacing the rescue address, stops every rule
  paying it in the same owner-signed change. Every write checks the rebuilt bridge rules as the
  first build does: checksummed, of the length each recipient input takes, at most 100 a chain.
- **A first bridge rule comes with a change of calls.** A change of recipients rewrites the bridge
  rules a ceiling holds and never adds one. Saving an address for a destination chain is a change
  of calls: every live wallet's ceiling is planned with its venues and cap as they are, before any
  is written, and the rules for that destination appear where a venue's routes reach it, with the
  24-hour cap of each route's token (decision 0305). A plan that changes no rule signs nothing.
  Otherwise the change is read back, stored and announced as `ceiling set` does, with
  `notice.dayCapAdded` when it adds a cap, even when it stops part way.
- **A 32-byte recipient.** A venue may declare a deposit whose recipient is a `bytes32` input, and
  whose token that arrives may be one too. Its rules list 32-byte recipients in lowercase hex. A
  deposit whose recipient is an `address` input lists only 20-byte recipients, and a `bytes32` one
  only 32-byte recipients; an entry of the other length refuses the ceiling, never padded.
- **Solana's id.** A chain of another family gets no rule id until a venue declares the id it
  gives that chain. An address saved for Solana is checked and stored now, and no v1 ceiling pays
  it until a bridge serves Solana from a main wallet; its entry says no route pays it yet.
- **Changes signed before.** A change of recipients signed before this decision lists one set of
  addresses; it stands for every chain, as it did when it was signed.

## Consequences

- An address the owner wants paid by a send on BNB Smart Chain and by a bridge to Base is saved
  twice, once for each chain, and each counts against its own chain's 100 addresses.
- `ceiling/get` shows each send recipient on the chain whose send rule lists it.
- A Solana address reaches a ceiling only through a deposit that binds 32 bytes and a declared id:
  the fake Privy and the live suite prove such a rule pays a saved Solana address and refuses an
  unsaved one, with a deposit no v1 venue builds.
- Saving an address for a destination chain writes every live wallet's call rules again with the
  owner key, and may make the ETH cap of decision 0305 on a ceiling that lacked it.

## Alternatives

- **One send list for every chain, as before.** It lets a send on BNB Smart Chain pay an address
  saved for Base. Lost to the owner's ruling.
- **The rescue address on every destination by default.** A contract wallet's address on BNB Smart
  Chain may be someone else's elsewhere (decision 0297); it waits for the code check.
- **Pad a 20-byte recipient into a `bytes32` input.** It would bind an EVM address in a deposit
  that also serves Solana, one more form to check for each route; no v1 venue needs it.
- **Key destinations by their CAIP-2 id in custody.** The rules name a number, and a bridge's
  number for Solana is its own, so the read-back could not tell which chain a rule pays on.
