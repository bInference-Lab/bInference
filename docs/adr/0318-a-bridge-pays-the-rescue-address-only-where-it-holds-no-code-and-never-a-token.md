# 0318. A bridge pays the rescue address only where it holds no code, and never a token

Status: Accepted

Accepted by the owner on 2026-11-01, with the owner's ruling of the same day: the rescue address may receive a bridge on a
destination only after decision 0297's plain-wallet check, read before each card, and a token
contract is refused as an address saved for an EVM destination once a reader exists.

## Context

[Decision 0297](0297-a-bridge-pays-a-saved-address-on-one-of-five-chains-and-only-a-read-there-says-it-arrived.md)
lets a bridge pay the rescue address on an EVM destination only while it holds no code on BNB
Smart Chain and none on the destination: the same key then holds it on both. Decisions
[0313](0313-a-saved-address-is-payable-only-on-the-chain-it-was-saved-for.md) and
[0314](0314-the-address-book-checks-an-address-through-its-chain-s-codec-and-names-the-reason-it-refuses.md)
left that check unbuilt, so the owner saves the rescue address per chain, and read an account only
on Solana, where a program or a token account is refused.

Three facts shape the check:

- A ceiling checks an address only when the owner key writes it. Code can appear at an address
  after that: a contract deployed to a counterfactual wallet's address, or an EIP-7702 delegation
  a key signs on one chain.
- An EVM token contract takes a transfer and keeps it: no key spends a balance held by the token's
  own address. A plain send on BNB Smart Chain cannot reach one, since the address book refuses
  venue contracts and the registry's tokens, but a destination has no registry of its own.
- An address book restored from a backup may hold entries saved before a check existed.

## Decision

- **An account code reader.** A chain family reads what code an account holds at its latest block:
  `none`, `delegation` (only an EIP-7702 designator), `token` (code that answers ERC-20's
  `totalSupply()` and `decimals()`, the decimals at most 255) or `contract`. The EVM family fills
  it over each chain's RPC failover, for BNB Smart Chain and each EVM destination.
- **The plain-wallet check.** A bridge may pay the rescue address on an EVM destination only when
  it reads `none` on the wallet's chain and on the destination. A delegation counts as code. The
  engine reads both after the policy passes and before the ceiling and the quote, so before each
  card, and again when the wallet queue takes the confirmed bridge. Code on either chain ends the
  bridge `failed_check` with `rescue_not_plain` before any card; a read that fails ends it with
  `recipient_unread`. The words of `rescue_not_plain` name the destination and tell the owner to
  save an address they control there, never the same address, which may not be theirs on that
  chain. At the queue, either keeps it `confirmed`, unsigned, and the queue reads again
  a block later until the confirmation runs out, as for a name it cannot read (decision 0308).
  On Solana the rescue address is never a bridge's payee.
- **No token on another chain.** `address/add` on an EVM destination reads the account last, as on
  Solana (decision 0314): a `token` is `address.not_wallet`, a failed read `chain.rpc_down`, and
  nothing is saved then. Plain wallets, delegated wallets and other contracts, such as a contract
  wallet, are saved.
- **Entries read again.** Before each bridge card the entry it pays is checked again: its address
  must not be one of the install's wallets (`address.own_wallet`), and on a destination with a
  reader it is read again, a token or, on Solana, a program or token account ending the bridge
  `failed_check` with `recipient_not_wallet`.

## Consequences

- A bridge to the rescue address or a saved address costs up to four node reads before its card.
- An owner whose rescue address is a contract wallet, or a delegated wallet, still saves its
  address per destination, as decision 0313 says.
- A token saved for a destination before this decision, or restored from a backup, stays in the
  book and is refused at its next bridge; the owner removes it.

## Alternatives

- **Check the rescue address once, when it is set.** Code that appears later would pass; the owner
  ruled for a read before each card.
- **Count a delegation as a plain wallet.** A delegation runs code on a fill, so the recipient is
  no longer the key alone on every chain. Lost.
- **Refuse every contract on a destination.** A contract wallet, such as an exchange's or a
  multisig, is a payee the owner may want; only a token keeps what it receives for good.
- **Read the entry only when it is saved.** A restored book would skip the read. Lost.
