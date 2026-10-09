# 0121. A rescue moves registry tokens and those a wallet holds a position in

Status: Accepted

## Context

[Decision 0044](../DECISIONS.md#d0044) says a rescue sends every token of every agent wallet to the
rescue address. An EVM chain cannot list the tokens an account holds: a node answers the balance of
a token it is asked about. Indexers that list holdings need a key or a paid plan, which
[rule 16](../ARCHITECTURE.md#rule-16) keeps optional, and a scan of every `Transfer` log to a wallet
since it was made is more history than public nodes serve. A token sent to a wallet unasked, such
as an airdrop meant to trick the owner, also runs code when it is transferred. The owner decided on
2026-10-10.

## Decision

A rescue reads, for each wallet on the rescue address's chain, its balance of the chain's coin, of
every token the chain registry lists, and of every asset the wallet holds a live position in. It
moves each of those with a balance above zero. A token known to neither the registry nor the
wallet's positions is not looked for.

## Consequences

- The rescue needs no key and reads a few balances per wallet: on BNB Smart Chain, the coin and
  eight registry tokens, plus the wallet's positions.
- Every token the agent bought, and every deposit that opened a position, is rescued. A token sent
  to the wallet that no position records stays behind, and so does any risk its transfer code
  carries.
- `WalletFactsSource.balances` reads the live balances, and each chain family names the asset
  namespace of its tokens, so a registry token's asset is written from its address.

## Alternatives

- **An indexer's list of holdings.** It needs a key and a third party that sees every wallet.
  Rejected for v1.
- **A scan of every transfer to the wallet since it was made.** Public nodes keep too little log
  history and limit ranges. Rejected.
- **The registry's tokens only.** It would leave behind every token the agent bought outside the
  registry. Rejected.
