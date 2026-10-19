# 0238. A launch's create call carries its settings and makes a new token

Status: Accepted

Accepted by the owner on 2026-10-19.

## Context

[Decision 0235](0235-a-launch-card-shows-every-setting-its-terms-hash-binds.md) puts every
launchpad setting on a launch's card and binds it with the terms hash, and lists what the venue
host checks of the create call: the token, the words, the pair, the metadata, the fee and the
first buy. The second review of the launch found two gaps:

- Nothing read the settings back from the create call's bytes. A launcher with a bug, or a hostile
  update, could write another tax or another tax recipient than the card shows, and every check
  passed: the owner's tap signed a token whose tax goes elsewhere for its whole life.
- The card's "new token" was the launcher's word. A launcher could name a token that exists and
  make the create call buy it: the card would show someone else's token under the owner's symbol
  and name.

## Decision

- **The decoder reads every setting.** A launchpad's decoder gives, with what the create call
  does, every setting it declares as the call's bytes write it: an `account` as its canonical
  account id on the launch's chain. The venue host refuses the plan (`decode_mismatch`, check
  `other_settings`) unless the call writes each setting the card shows at its value, an account as
  the same account, and no other.
- **The contract proves it.** The launcher contract every launchpad passes checks that a create
  call decodes to the settings it was built with, for the launch's settings and for a second set
  unlike them, so a decoder that echoes the request fails. Its own test shows the contract fails a
  launcher that writes another tax.
- **The token is new.** A launcher names the token at the address its create call makes, before
  the call runs. Before a launch's simulation, and so before its card, the engine reads whether
  that address holds contract code on its chain; one that does is another token, and the launch
  ends `failed_check` with `effects_differ` and the owner's notice. A read that fails leaves the
  launch for the next pin check. Without a reader of code, the engine proposes no launch.

## Consequences

- What the owner confirms on a launch's card is what the create call writes, setting by setting.
- `DecodedLaunch` gains `options`, and the launcher contract's subject gains `otherOptions`: each
  launchpad task (Flap, four.meme, Genius.fun, Brew) decodes its settings from its own call data,
  gives a second set of settings for the contract, and names its token at the address its
  contracts give it before the create call.
- A launchpad whose token address the create call alone decides, with no way to know it before,
  cannot be hosted until its plugin can name it.
- The engine gains a reader of a token's code; the self-hosted root reads `eth_getCode` at the
  latest block through the chain's failover.

## Alternatives

- **Trust the launcher's build.** It is plugin code, and the review found it the one place the
  card's settings were not checked. Rejected.
- **Read the token's facts instead of its code.** An existing contract that answers no symbol or
  no decimals would pass. Rejected.
- **Check the address against the launchpad's own address formula.** It needs each launchpad's
  formula in the engine, and the code read covers every launchpad. Rejected for now.
