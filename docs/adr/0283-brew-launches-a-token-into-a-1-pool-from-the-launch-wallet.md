# 0283. Brew launches a token into a 1% pool from the launch wallet

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0278](0278-brew-trades-in-its-pools-and-only-its-single-pair-factory-s-launches-count.md)
reads Brew's launches; this one makes them. Brew's sources, read on 2026-10-20:

- **Its docs** (brew.family/docs): a launch has a supply of 1,000,000,000, a 1% pool fee and
  liquidity locked for good; the pair is BNB (WBNB inside the pool), USDT or another standard BSC
  token, never one with a transfer fee or a rebase; the launch reads the factory's current launch
  fee; creator fees go to a fee recipient, or to the token's holders through a holder
  distributor. "Brew is not available to U.S. citizens."
- **BrewFactory's verified source** (Sourcify, chain 56, exact match): one `launch(LaunchParams)`
  call (0x7cd1f68e) makes the token by CREATE2, its PancakeSwap V3 pool at `initialTick`, places
  the whole supply from that tick up, or across up to ten ranges, and locks every position. It pays
  the fee in the coin, refuses one above `maxLaunchFeeWei`, takes a coin first buy as the value
  beyond the fee and a token one by `transferFrom(msg.sender)`, holds the first buy to
  `initialBuyMinTokensOut`, and refunds what a buy past the liquidity does not spend. The fee
  recipient defaults to the caller when zero. `predictTokenAddress` gives the token's address.
- **BrewLiquidityLocker** credits the creator's part of the pair-side fees to the fee recipient,
  paid only on that recipient's own `claimFees`; the token side is burned, and the protocol keeps
  at most half of the pair side.
- **BrewDistributorFactory's verified source** predicts each token's holder distributor
  (`predict`), which a launch may name as fee recipient; the distributor spends what it collects
  on the token and burns it, for good.
- **On chain:** `launchFeeWei()` is 0, `protocolLpFeeBps()` 5000, launches are not paused. Every
  launch read on chain is a 1% pool at a tick that puts the token at about 8 BNB, 5,000 USDT or
  $5,000, with an address that ends in 6666.

The owner ruled on 2026-10-20: the picture is a small one written into the create call (decision
[0279](0279-a-launchpad-may-write-the-owner-s-picture-into-its-create-call.md)); a fixed start of
8 BNB, or 5,000 USDT or USDC; always 1% and one range, both on the card; any registry token
besides, with a starting market cap the owner may set, else $5,000 at binference's price of the
pair (decision [0280](0280-a-launch-setting-may-be-an-amount-of-the-pair-left-for-the-launchpad-to-work-out.md)),
refused when there is none; holder rewards as a setting, off by default; an address that ends in
6666; and Brew launches allowed, with a warning on every card that Brew's site is not available to
U.S. citizens (decision
[0281](0281-a-launchpad-may-show-warnings-of-its-own-on-every-launch-card.md)).

## Decision

- **What a launch is.** The `brew` launcher launches through BrewFactory's `launch` alone, from
  the launch wallet, against the chain's coin (WBNB in the pool) or a registry token of the chain
  other than its wrapped coin that the composition root names for Brew, with its decimals: each
  read as a standard token with no transfer fee and no rebase, as Brew's docs ask, so a token the
  registry adds later joins only once checked. A launch
  against the wrapped coin as a token is `no_route`: it names the coin.
- **What every launch writes.** A supply of 1,000,000,000 with 18 decimals, the 1% fee tier, no
  ranges of its own (the whole supply in one range from the starting tick up), the first buy's
  recipient the launch wallet, a fee recipient that is never zero, the quoted launch fee as both
  the fee it pays and `maxLaunchFeeWei`, and a salt found off line so the token's address ends in
  6666, which the factory's `predictTokenAddress` must give too.
- **Its settings.** `poolFeeRecipient`, an outside-only account (decision 0277's rule: binference
  never claims), given exactly when `holderRewards` is off; `holderRewards`, off by default, which
  names the token's holder distributor as fee recipient; `startMarketCap`, an optional amount of
  the pair; `poolFee` (`onePercent`) and `liquidity` (`oneRange`), one word each; and, with holder
  rewards on, `holderDistributor`, an outside-only account only the build works out (decision
  0280). The launcher checks that the fee recipient, holder rewards and the distributor go
  together, and names the step a launch needs (decision 0284): a fee recipient with holder
  rewards off (`recipient_needed`), none with them on (`recipient_unused`). The card shows each, the distributor whole; the decoder reads each back from the
  call's bytes, the start through the tick the build that made the call wrote, takes a call sent
  to that build's factory alone, and refuses any other fee tier, supply, range or tick.
- **The holder distributor.** Its address is worked out off line: CREATE2 from the registry's
  distributor factory, with the token's address as the salt and BrewHolderDistributor's creation
  code with BrewFactory and the token as its arguments, as `BrewDistributorFactory.predict` reads
  (its verified source). The build refuses a `predict` answer that differs, and the zero address,
  which the factory would read as the launch wallet (`brew.no_route`); the engine refuses one of
  the install's wallets (`own_wallet_recipient`). The decoder reads holder rewards as on exactly
  when the call's fee recipient is that off-line address.
- **The start.** The owner's starting market cap, else the pair's fixed start, else $5,000 at
  the pair's price, rounded down. The pool's starting tick is the highest on the 1% tier's
  spacing of 200 whose price is at most that market cap over the supply, worked out in integer
  arithmetic. A start worked out from the pair's USD price also names `startBasis` (`usdPrice`),
  a worked-out choice (decision 0280), so the card says it is $5,000 at binference's price beside
  the amount in the pair, and the decoder reads it from the build that made the call. A pair with
  no start is `start_unpriced`, and a start no tick reaches
  `start_unreachable` (decision
  [0284](0284-a-launchpad-names-why-it-refuses-a-launch.md)).
- **The words and the picture.** The metadata address is the document Brew's own launches write:
  `v` 1, the description, website, X and Telegram links the launch gives, and the picture as a
  `data:image/...;base64,` address, 2,048 bytes in all; the launcher tells the engine how many
  bytes of picture fit beside the words. The name takes 64 bytes and the symbol 32, as the factory
  does, a description 600 and each link 100, so the words alone always fit.
- **The quote.** It reads the launch fee and the pause, works out the start, and for a first buy
  runs the steps unsent from a wallet that holds only the fee and the first buy: the wallet's new
  tokens are the first buy's output; a run that fails, refunds part of the first buy or gets none
  of the token is `dry_run_failed`. Paused launches are `launch_paused`.
- **The first buy keeps its minimum.** The factory holds the first buy to it, so the launcher
  refuses a minimum of 0 and does not declare `noFirstBuyMin`.
- **Launch wallets alone.** `launch` is a launch wallet's call alone (`isLaunchWalletOnly`), and
  the factory a spender only a launch wallet approves, for a token first buy's exact approval. The
  venue only launches (decision
  [0282](0282-a-venue-that-only-launches-tokens-needs-a-launch-wallet-not-a-main-ceiling.md)).
- **No commission.** Nothing in the call pays anyone the owner did not name: the launch fee goes
  to Brew's treasury, and the protocol's part of the pool fees is Brew's own.

## Consequences

- A Brew launch runs through the engine's launch path from the launch wallet, with every setting,
  the written picture and the U.S. warning on its card.
- BrewToken's creation code, as BrewFactory holds it, and BrewHolderDistributor's, as the
  distributor factory holds it, are part of the plugin, each held to a real address by a unit test
  and to its factory's own prediction at each build.
- The decoder knows a call's start and its factories only from the build that made it, in the
  same engine process; a call the venue never built is `unknown_call`.
- The token's address rests on the call's words and salt, which the build fixes; a factory that
  is paused or charges another fee by the block makes the call revert, which the simulation
  before the card and the reconcile alarm catch.
- A launch wallet's ceiling made before Brew joined lacks `launch`; `binference check` names it
  (`wallets.launch_calls`) and a launch ends `ceiling_lacks_call` before its build.

## Alternatives

- **Ranges of the owner's own, or another fee tier.** The owner chose one range at 1%.
- **A random salt.** The owner chose an address ending in 6666, as Brew's own launches have.
- **Compute the start from the engine's price for BNB and the stables too.** The owner chose the
  fixed starts, which need no price.
