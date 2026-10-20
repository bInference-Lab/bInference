# 0276. A launchpad with no picture API takes a picture link the owner hosts

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0234](0234-a-token-launch-waits-in-quoted-for-its-pin-and-signs-from-the-launch-wallet.md)
reads the owner's picture once, has the launchpad upload it and the words through its own API, and
waits in `quoted` for the launchpad's pin. Every launcher had `pin` and `pinStatus`.

Genius.fun has no such API: "Genius does not expose a public REST or WebSocket API; the endpoints
behind this site are same-origin only" (genius.fun/docs/integrate, read on 2026-10-20). Its create
call names the picture as `logo`, "a URL (≤ 512 bytes; Genius-created launches use ipfs:// URIs)",
and genius.fun shows only logos that pass its own moderation (Genius Launchpad mainnet
integration guide, genius.fun/docs/genius-launchpad-mainnet-integration-guide.pdf). Two live
launches read on chain on 2026-10-20 name `ipfs://bafkrei…` logos.

The owner chose, on 2026-10-20, that the owner gives a link they host, and that a Genius.fun launch
needs one.

## Decision

- **A link setting.** A launch setting may be of type `link`: an `ipfs://` or `https://` address,
  something after the scheme, at most 512 bytes in UTF-8, and no C0 or C1 control character or
  DEL. Any other value is `protocol.bad_args` when the launch is proposed, as every setting is
  (decision 0235). Nothing in binference opens, fetches or reads it, and no surface previews it.
- **The card shows it whole.** A link setting's line names its value `link`, which a card shows in
  full through the outside text display, up to 512 characters: `launch.option.pictureLink`,
  "Picture at {link} (binference never opens it)", with its Chinese words in the catalog.
  The create call must write it byte for byte; the decoder reads it back as a setting and the host
  checks it like every other one (decision 0238).
- **A launcher with no upload.** A launcher may leave out `pin` and `pinStatus`, both together; one
  alone is refused when the venue is defined (`plugin.bad_venue`) and when it is hosted
  (`venue.bad_declaration`). Such a launchpad reads no picture: the request's `image`, which
  protocol v1 keeps required, names no upload the engine reads. Its build gets no metadata
  address, and its decoder names none.
- **No pin wait.** The launch's quote then holds no picture, metadata address or pin, and its pin
  wait ends at its quote. The pin follow moves such a launch from `quoted` to `assessed` at once,
  so it passes through the same states as any launch, and its simulation and card follow.
- **Its card.** No picture line and no line saying the picture and words are public.
- **Its notice.** A launch from a launchpad that uploads nothing that stops before its card tells
  the owner that nothing was signed or made public (`notice.launchStopped` with `private`). The
  `upload_lost` words now say the launch stopped before its steps were ready, true for both kinds.

## Consequences

- Genius.fun launches can run through the engine's launch path with the owner's own picture link.
- The token's picture rests on a host the owner keeps; binference cannot tell whether the link
  works, or whether genius.fun will show it.
- `LaunchOptionType` gains `link`, `Launcher.pin` and `Launcher.pinStatus` become optional,
  `UploadingLauncher` names a launcher with both, `LaunchBuildRequest.metadataUri` and
  `DecodedLaunch.metadataUri` become optional, the stored launch quote's `image`, `metadataUri`
  and `pin` become optional, the launch host gains `takesUpload`, and the chain package's fakes
  gain `createFakeLinkLauncher`. Specs 1, 4 and 6 say so.
- Protocol v1 keeps `image` required. A later version can make it optional; until then a surface
  sends an upload id the engine does not read for such a launchpad.

## Alternatives

- **Pin the owner's picture through an IPFS pinning service the owner signs up for.** A new
  outside service and secret, for a picture genius.fun may not show. Not chosen by the owner.
- **Launch with no picture.** Not chosen by the owner.
- **Upload through genius.fun's own site endpoints.** They are same-origin only and not offered to
  integrations. Rejected.
- **Make `image` optional now.** A field that turns optional is a breaking change inside protocol
  v1. Rejected for this version.
