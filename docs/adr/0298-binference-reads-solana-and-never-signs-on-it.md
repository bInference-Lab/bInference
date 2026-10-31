# 0298. binference reads Solana and never signs on it

Status: Accepted

Accepted by the owner on 2026-10-30.

## Context

On 2026-10-29 the owner added Solana to the chains a bridge delivers to (decision 0297). Every chain
binference touched until then was EVM: its addresses are 20 bytes written in checksummed hex, its
receipts come from `eth_getTransactionReceipt`, and `wallets.family` is `evm` for every wallet.

Solana differs in each of these:

- An address is the base58 text of 32 bytes, with no checksum. A typo can still decode to 32
  bytes.
- Tokens sit in token accounts that a program owns, one per owner and mint. A bridge pays the
  owner's associated token account; a payment named to a token account's own address lands where
  no wallet can spend it.
- A deposit on BNB Smart Chain names a Solana recipient as a 32-byte argument, which the ceiling
  must compare with the saved addresses.

Core code never names a chain ([ARCHITECTURE.md section 21](../ARCHITECTURE.md#section-21)): a
chain is reached through its family's ports. binference needs no Solana wallet: the funds a bridge
delivers there are the owner's.

## Decision

- **A read-only family.** `solana` is a chain family that binference reads and never signs on.
  Mainnet is CAIP-2 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`; an account is CAIP-10 with its
  base58 address; a token is CAIP-19 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:<mint>`.
- **Its own package.** `chain-solana` fills the address codec and the delivery reader on Solana's
  official JavaScript SDK, behind the RPC port, with the registry's keyless public endpoints and
  their failover. It has no signer, wallet, transaction preparer, relay sender or simulator, and
  `wallets.family` stays `evm`.
- **The codec.** An address decodes from base58 to exactly 32 bytes, else it is refused; it prints
  back as its canonical base58 text. Its recipient bytes are those 32. With no checksum to catch a
  typo, every card shows a Solana address whole.
- **Which accounts.** `address/add` on Solana reads the account at the latest finalized slot. An
  executable program, or an account a program other than the System Program owns (a token
  account, an account a program derived), is refused with `address.not_wallet`. An address with no
  account yet, or one the System Program owns, is saved.
- **The delivery read.** For a bridge's fill, the reader reads the transaction signature the
  venue's status names at `finalized` commitment, checks that it succeeded, and takes the
  recipient's change of the delivered mint from the transaction's token balances whose owner is
  the recipient, or the recipient's lamports for SOL. The bridge counts as delivered only when that
  change is at least the quote's minimum (decision 0297).
- **No branching on Solana.** The chain family registry maps a CAIP-2 namespace to its codec and
  reader. The address book, the ceiling's recipient bytes, the cards and the delivery read take
  the family from the account's namespace.

## Consequences

- The package graph gains `chain-solana`, which only `chains`' registry and the composition root
  use, and the built-package smoke loads it.
- Solana's CAIP-2 id lives in the registry alone, so `check:chain-literals` stays green.
- A saved Solana address costs one more read when it is added, and none afterwards: the ceiling
  holds its 32 bytes.
- An owner who wants funds on Solana as an exchange deposit must give the exchange's wallet
  address, never a token account's.
- Nothing can move funds on Solana for the owner: no rescue, no trade, no send there.

## Alternatives

- **Trust the bridge's status for Solana.** Decision 0297 reads every delivery on its own chain.
- **An indexer's API for Solana deliveries.** It would be one more outside service to trust with
  the answer, beside the RPC that already gives it.
- **A Solana wallet in Privy, to sign there later.** Nothing in v1 needs it, and each wallet adds a
  ceiling to keep.
- **Accept any 32-byte address.** A token account's address would pass and the funds would be
  lost.
