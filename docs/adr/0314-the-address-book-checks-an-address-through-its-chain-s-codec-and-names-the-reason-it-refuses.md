# 0314. The address book checks an address through its chain's codec and names the reason it refuses

Status: Accepted

Accepted by the owner on 2026-11-01: the six codes, the room per chain, and own wallets refused on
destinations, the lead's ruling of 2026-10-31 (no bridging to binference's own address on another
chain).

## Context

[Decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md)
lets the owner save an address on a chain a bridge delivers to, and
[decision 0298](0298-binference-reads-solana-and-never-signs-on-it.md) reads a Solana address
through its family's codec and refuses a program or a token account. Spec 1 answered every address
a codec refused, and every chain outside the registry, with `protocol.bad_args`, whose words say
only that the request holds something wrong. An owner who pasted a Solana address for Base, or one
character short, learned nothing about what to fix.

The engine's chain registry holds the chains its wallets trade on, BNB Smart Chain in v1. A
destination chain has no wallet, signing scheme or simulator there: it needs only a codec, and on
Solana a reader that tells a wallet from a program. Each ceiling rule of a chain lists at most 100
addresses (Privy's `in`).

An EVM address is the same key on every EVM chain. Saving one of binference's own wallets for Base
would let a bridge from a main wallet pay a wallet the same machine's keys control, around the
"paid from outside only" rule of the launch and bridge wallets (decisions 0217 and 0307).

## Decision

- **Where.** The engine takes the destination chains as data: each its CAIP-2 id, its family's
  address codec and, where its accounts may be programs, an account kind reader. The composition
  root names the registry's five destinations. A chain that is neither a wallet chain nor one of
  them is `address.unknown_chain`.
- **The codec decides the form.** An address the chain's codec reads is saved in its canonical
  form, with its recipient bytes. An address another family's codec reads is `address.other_chain`;
  any other text `address.malformed`. Each code's words name the form expected and the next step,
  and the CLI checks the same before it asks for the owner key, with the same reason.
- **Own wallets.** On a destination chain, an address whose recipient bytes are those of any wallet
  of the install, of any agent and role, is `address.own_wallet`. On a wallet chain the refusals
  of decisions 0218 and 0307 stay as they are.
- **The room.** A chain whose ceiling rule lists 100 addresses already, the rescue address in
  effect and a new one that waits counted on their own chain, is `address.chain_full`, before any
  owner-key change. `address/list` shows, for each chain other than the wallets' that holds a saved
  address, how many it holds and the most one rule lists: `room: { chain, used, most }[]`, and the
  CLI prints `address.room` once per chain. The most comes from custody's ceiling editor, so the
  engine names no custodian's limit. A list custody refuses on a write, as a race of two saves
  may leave, is `address.chain_full` too.
- **Read last.** On a chain with an account kind reader, the account is read only once every other
  check passed and the book does not hold it already: `address.not_wallet` for a program, a token
  account, an account that holds data such as a durable nonce, and an address no key can sign
  for, such as a program-derived address, which is refused unread; `chain.rpc_down` for any read
  that fails, a node that does not answer or an answer the reader cannot take, and nothing saved
  unread.
- **No route yet.** An entry saved for a destination no bridge rule of the agent's wallets reaches
  is answered with `noRoute`, and `address list` says no bridge route pays it yet, as the wallets'
  stored ceilings read now. It stays saved, so a later change of calls that reaches its chain pays
  it.
- **The rescue address on a destination** is listed there only after decision 0297's code check,
  which this decision does not build: until then the owner saves it for that chain.

## Consequences

- Six error codes join spec 1's `address` group, each with English and Chinese words; the protocol
  change is additive.
- `address/list`'s `room` was specced as one count for every other chain; it is one per chain,
  since each chain's rule holds its own 100.
- The address book holds the recipient bytes the codec gave, which a bridge's recipient check reads
  later; custody derives the same bytes from the CAIP-10 account through the same codec, so the
  custody port keeps one account form for every chain.
- Every Solana address saved in v1 reads `noRoute`: no v1 bridge pays Solana from a main wallet
  (decision 0313).
- An owner who wants the rescue address paid on Ethereum saves it there as a saved address.

## Alternatives

- **Keep `protocol.bad_args`.** It tells an owner that something is wrong but not what.
- **Put the destinations in the chain registry.** Each registered chain needs a family with a
  signing scheme and a simulator; Solana has neither in v1, and an EVM destination would look like
  a chain the wallets trade on.
- **One room for every other chain.** A sum over chains says nothing about the chain that is full.
- **Read Solana first.** A refused address would cost a node read for a reason the engine already
  knew.
