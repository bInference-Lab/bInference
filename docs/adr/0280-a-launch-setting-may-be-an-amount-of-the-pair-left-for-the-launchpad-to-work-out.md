# 0280. A launch setting may be an amount of the pair, left for the launchpad to work out

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0235](0235-a-launch-card-shows-every-setting-its-terms-hash-binds.md) has each
launchpad declare its settings, every one a share, a count, a flag, a choice, an account or a
link (decision 0276), each given by the request or by its fixed default, and each on the card.
Brew's launch needs three things those cannot say, the owner ruled on 2026-10-20:

- **A starting market cap in the pair's units, which the owner may set for any pair.** Left out,
  BNB and the stablecoins start at a fixed size and any other pair at $5,000 at binference's
  price of the pair when the launch is quoted, refused when it has none. A share or a count is
  never an amount of money, and no fixed default can depend on the pair or its price.
- **A setting that only some launches carry.** With holder rewards on, the creator's fees go to
  Brew's holder distributor, so the launch names no fee recipient; with them off, it must.
- **Both on the card**, and checked against the create call's bytes.

## Decision

- **An `amount` setting.** A launch setting may be of type `amount`: base units of the launch's
  pair, above 0, as a decimal string with no leading zero. The card shows it as an amount of the
  pair.
- **An optional setting.** A setting with no default may be `isOptional`: a request may leave it
  out. An optional setting with a default is refused when the venue is defined
  (`plugin.bad_venue`).
- **The quote works it out.** A launcher's quote may name values for optional settings the
  launch left out (`LaunchQuote.settings`). The launch host refuses a quote whose values name a
  setting that is not an optional one the launch left out, or that does not fit its setting
  (`decode_mismatch`). The engine adds them to the launch's settings in the order the launchpad
  declares them, so the card shows them, the launch's quote keeps them under the terms hash, and
  the build check holds the create call to them like every other setting. An optional setting
  neither the request nor the quote names is not on the card, and the create call must not write
  one.
- **The launchpad's own check.** A launcher may declare `checkOptions`: whether the settings it is
  given go together, each already checked against its declaration. A launch whose settings do not,
  or whose check throws, is `protocol.bad_args` before anything is stored.
- **The pair's price.** The engine reads binference's USD price of the pair through its price
  source as it quotes a launch, and gives it to the launchpad with the terms (`pairUsdPrice`),
  absent when there is none. It is what the policy prices the launch with, read once more.

## Consequences

- `LaunchOptionType` gains `amount`, `LaunchOption` `isOptional`, `Launcher` `checkOptions`,
  `LaunchQuote` `settings`, `LaunchTerms` `pairUsdPrice`, the launch host `launchOptions`, and the
  launch path the price source. The chain package's fake launcher can quote settings.
- Specs 1 and 4 say so. Launchpads that declare no optional setting and no check work as before.
- The card shows a value a launchpad worked out, which the owner confirms like any other. A
  launchpad that works out a starting price from `pairUsdPrice` puts the engine's price on the
  card and in the create call; a move of the price after the quote changes neither.

## Alternatives

- **A setting per pair**, such as a choice of fixed sizes. The owner asked for any pair, with a
  value the owner may set.
- **Work the start out in the engine.** A starting price is the launchpad's own arithmetic, ticks
  and tick spacing among it. Rejected.
- **Make the fee recipient a choice with an account beside it.** It still needs an account a
  launch with holder rewards must not give. Rejected for the optional setting and the check.
