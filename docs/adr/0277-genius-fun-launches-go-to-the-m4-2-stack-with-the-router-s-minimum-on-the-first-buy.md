# 0277. Genius.fun launches go to the m4.2 stack with the router's minimum on the first buy

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decisions 0234](0234-a-token-launch-waits-in-quoted-for-its-pin-and-signs-from-the-launch-wallet.md)
to [0241](0241-a-failed-launch-may-keep-its-exact-approval-and-the-engine-alone-holds-the-launch-wallet-rule.md)
give each launchpad a launcher, and
[decision 0217](0217-a-launch-wallet-trades-on-launch-contracts-under-a-ceiling-of-its-own.md) a
launch wallet the owner funds from outside. Genius.fun's sources, read on 2026-10-20:

- **Its docs.** The Integrate page (genius.fun/docs/integrate), the mainnet integration guide it
  links (genius.fun/docs/genius-launchpad-mainnet-integration-guide.pdf), the deployment manifest
  (genius.fun/contracts/manifest.json) and the 4.2.0 ABIs it publishes
  (genius.fun/contracts/abi/4.2.0/). Release `prod-periphery-m41-20260921b`, stack
  `bnb-mainnet-m4.2`.
- **Verified sources** on Sourcify, chain 56: `GeniusLaunchFactory`, `GeniusLaunchAndBuy` and
  `GeniusLaunchDeployer`.
- **On chain:** the factory's `launchFee()` is 0.002 BNB, `maxCreatorTaxBps()` is 0, launches are
  open to any wallet, and USDT and USDC are approved pairs.

What they say:

- **Two create calls.** The factory's `launchToken(TokenParams, configId, pairToken,
toFoundation)` (0xe78b4707) makes a token and its curve. The router's `launchAndBuy(TokenParams,
configId, pairToken, quoteIn, minimum, recipient, toFoundation)` (0x71b27635) makes them through
  the factory and runs the first buy on the new curve in the same call; `minimum` binds the buy,
  and the router appends the buy's recipient to the wallets the launch window's snipe tax spares.
- **The fee.** `msg.value` is the launch fee, plus the first buy for a launch against the coin.
  Against a token, the router pulls the first buy from its caller by `transferFrom`, after an
  approval of the router.
- **The creator's terms.** `TokenParams` carries the words, the logo link, a
  `creatorFeeRecipient`, a `creatorTaxBps` that must be 0, `buybackEnabled`, which the m4.2
  Foundation fee policy requires on (`InvalidFeePolicy` otherwise, verified source of the curve),
  the `expectedEconomics` digest of `previewLaunchEconomics` and a salt. The creator fee recipient
  receives the creator's 0.25% of every trade's fee and the 1% destination share unless
  `toFoundation` sends it to the Genius Foundation's vault for good; it claims them from the fee
  escrow, and the contracts spare it the snipe tax.
- **The token's address** is CREATE2 from the launch deployer, with the launcher, the salt and the
  full launch configuration. The docs advise `predictLaunchAddresses` over computing it.

The owner ruled on 2026-10-20: the picture is a link the owner hosts (decision 0276); the creator
fee recipient is required, with no default, as Flap's tax recipient is; `toFoundation` is always
false and never offered; no wallet is exempted from the snipe tax.

## Decision

- **What a launch is.** The `geniusfun` launcher launches on the m4.2 stack alone, against the
  chain's coin, USDT or USDC: with a first buy through the router's `launchAndBuy`, without one
  through the factory's `launchToken`. The registry lists the router as `router-m4-2`.
- **Its settings.** `creatorFeeRecipient` (an account) and `pictureLink` (a link, decision 0276),
  both required. The card shows both, and the decoder reads both from the call's bytes.
- **What every launch writes.** Launch configuration 0, no creator tax, the buyback on, no Discord
  or Farcaster link, `toFoundation` false, and no snipe tax exemptions. A create call is the
  venue's only when it would write the same bytes for what it reads, with none after them, so the
  decoder refuses a call that chooses the Foundation or writes any other fixed value.
- **The words.** The description, the website, X and Telegram links go into the create call, held
  to the launch deployer's byte limits (decision 0275).
- **The first buy keeps its minimum.** The router binds it, so the launcher does not declare
  `noFirstBuyMin`, the registry does not list Genius.fun among the launchpads whose first buy runs
  unbound, and the host holds the call's minimum to the quote less the agent's slippage.
- **The quote and the token.** The launcher reads the factory's fee, whether launches are open to
  the wallet, whether the pair is approved, and the economics digest, then runs the steps unsent
  on the chain's simulator from a wallet that holds only the fee and the first buy. The first buy's
  output is what the wallet receives; the token is the one the factory mints. A run that reverts,
  mints no single new token, or refunds part of the first buy, as a buy that completes the curve
  would, throws. The build reads the economics again, writes a fresh salt from the `Random` port,
  runs the steps the same way to name the token, and keeps the token for its decoder, which reads
  every other field from the bytes. A fee other than the quoted one fails the build.
- **Launch wallets alone.** `launchAndBuy` and `launchToken` are calls only a launch wallet makes
  (`isLaunchWalletOnly`, decision 0271): only a launch wallet's ceiling allows them, and the signer
  refuses them from any other wallet. The router is also a spender, for a token first buy's exact
  approval.
- **No commission.** Nothing in the call pays anyone but the launch fee the factory charges.

## Consequences

- A Genius.fun launch runs through the engine's launch path from the launch wallet, with the
  creator fee recipient and the picture link on its card.
- An agent wallet's ceiling may list the router as a spender. The router takes a token only from
  the caller of `launchAndBuy`, which no agent wallet's ceiling allows, so such an approval moves
  nothing.
- The decoder knows a create call's token only from the build that made it, in the same engine
  process; a call the venue never built is `unknown_call`. The engine decodes a launch only at its
  build.
- The token's address rests on the factory's configuration at the dry run. A change of it before
  the block makes the call revert (`LaunchEconomicsMismatch`) or name another address, which the
  simulation before the card and the reconcile alarm catch.
- A launch wallet's ceiling made before this change lacks the two create calls; `binference check`
  names them (`wallets.launch_calls`) and the launch ends `ceiling_lacks_call` before its build.
- The fork test launches a token with its first buy from the launch wallet (gate Y7).

## Alternatives

- **Compute the token's address.** The docs advise against it, and it needs the full launch
  configuration, fee policy among it. Rejected.
- **Read `predictLaunchAddresses`.** It takes the same full configuration. Rejected.
- **Offer `toFoundation` or exemptions.** The owner chose neither.
- **Launch on m4.1 too.** The docs name m4.2 as the active stack. Rejected.
