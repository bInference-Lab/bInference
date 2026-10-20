# 0275. A create call that writes a launch's words on chain must write the card's

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0235](0235-a-launch-card-shows-every-setting-its-terms-hash-binds.md) has the venue host
check a launch's create call against its card: the token, the name, the symbol, the pair, the
metadata address, the fee and the first buy, and every launchpad setting
([decision 0238](0238-a-launch-create-call-carries-its-settings-and-makes-a-new-token.md)). Flap
puts the description and links in metadata it uploads, so its create call names only the metadata
address.

Genius.fun has no metadata API. Its docs ("Integrate", genius.fun/docs/integrate, read on
2026-10-20) say: "Genius does not expose a public REST or WebSocket API; the endpoints behind
this site are same-origin only. Integrate on-chain." Its create calls carry the token's words in
their own bytes (`TokenParams`): the name, the symbol, the logo link, the description and five
social links, each with a byte limit the launch deployer enforces (name 64, symbol 16, logo 512,
description 2,048, each social link 256; `MetadataTooLong` otherwise, verified source of
`GeniusLaunchDeployer` on Sourcify, chain 56). A card counts characters, 1,000 for a description
(decision 0239); 1,000 Chinese characters are about 3,000 bytes.

## Decision

- **The decoder names the words it reads.** A launchpad's decoder of a create call that writes the
  description and links on chain names them (`DecodedLaunch.words`), each as the bytes write it, an
  empty text for one the launch does not give.
- **The host checks them.** The venue host refuses the plan (`decode_mismatch`, check
  `other_launch`) unless the description and each link, at its site, are the card's. A launchpad
  that declares limits for its words must name them; a decoder that leaves them out is refused the
  same way.
- **The builder gets them.** The host gives the launch's description and links to every build, so
  a launchpad that writes them on chain writes the card's.
- **Limits are checked first.** A launcher may declare, in UTF-8 bytes, the most its create call
  takes for the name, the symbol, the description and each link (`wordLimits`). A launch over one
  is `protocol.bad_args` when it is proposed, before anything is stored, uploaded or sent, beside
  the card's own limits of decision 0239.
- **The contract proves it.** The launcher contract checks that a launcher with word limits
  decodes a create call to the words it was built with, and its own test shows the contract fails
  a launcher that writes other words.

## Consequences

- A launchpad whose create call keeps the words on chain gets the same guarantee as its settings:
  the owner's tap confirms the words the token carries for good.
- `DecodedLaunch` gains `words`, `LaunchBuildRequest` gains `description` and `links`, `Launcher`
  gains `wordLimits`, and the launch host gains `fitsWords`. Spec 6 says so.
- The launch host's pin takes only the picture: the words reach every launcher through the launch
  itself.

## Alternatives

- **Leave the words unchecked, as Flap's metadata is.** Flap's words sit behind an address the
  card shows; here they are in the bytes the tap signs, and a launchpad's builder could write
  others. Rejected.
- **Cut words to fit the bytes.** The token would carry words the owner never saw. Rejected.
- **Check bytes only at the build.** The owner would learn of it after the quote and the policy,
  as a launchpad fault. Rejected.
