# 0279. A launchpad may write the owner's picture into its create call

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decision 0234](0234-a-token-launch-waits-in-quoted-for-its-pin-and-signs-from-the-launch-wallet.md)
has a launchpad upload the owner's picture through its own API and waits for its pin;
[decision 0276](0276-a-launchpad-with-no-picture-api-takes-a-picture-link-the-owner-hosts.md) has
one with no such API take a link the owner hosts. Brew fits neither:

- Brew has no picture API. Its factory's create call takes a `metadataURI` of at most 2,048 bytes
  (BrewFactory's verified source), which BrewToken keeps for good.
- Every Brew launch read on chain on 2026-10-20 writes that address as a
  `data:application/json;base64,` document whose `image` is either a small inline
  `data:image/...;base64,` picture or an `onchain://56/<contract>` picture that an earlier
  transaction deployed as contract code. brew.family shows a token's picture only in those two
  forms, not from an `https://` or `ipfs://` link.

The owner chose, on 2026-10-20, a small picture written inside the create call, about 1 KB, such
as a 64 by 64 WebP, which brew.family shows; the card shows its size and dimensions.

## Decision

- **A third place for the picture.** A launcher may declare `pictureBytesFor(words)`: it writes the
  owner's picture into its create call, and answers how many bytes of a picture fit there beside
  the launch's description and links. It then has no `pin` or `pinStatus`; one that declares both
  is refused when the venue is defined (`plugin.bad_venue`) and when it is hosted
  (`venue.bad_declaration`). The launch host names where each launchpad takes its picture,
  `upload`, `create_call` or `link` (`picturePlace`), in place of `takesUpload`, and asks
  `pictureBytesFor` under a guard: an answer that throws, or is no whole number above 0, fits no
  picture.
- **The request.** The launch's `image` names the owner's upload, as for a launchpad that uploads;
  `none` is `protocol.bad_args` before anything is stored.
- **One read, held to its limits.** The engine reads the upload once, as for an upload: the
  proposer's own, a PNG, JPEG or WebP by its first bytes, of at most 5 MiB. It must also tell its
  width and height in its header (PNG's IHDR chunk, JPEG's first frame header, WebP's VP8, VP8L or
  VP8X chunk), else the launch ends `failed_check` with `image_unreadable`, and it must be no
  larger than `pictureBytesFor` answers for the launch's words, else `failed_check` with the new
  reason `picture_too_large`. Both come before anything is built, and nothing is sent anywhere.
- **The build.** The launcher's build gets the picture's bytes, its own copy. Its decoder names the
  picture the call writes, by its type and the SHA-256 of its bytes (`DecodedLaunch.picture`), and
  the host's build check refuses a call whose picture is not the one the engine read, or that
  writes one where none was given, as `other_launch`.
- **No pin.** The launch's quote keeps the picture (type, bytes, digest, width and height) and no
  metadata address or pin, so its pin wait ends at its quote and it moves on at once, as decision
  0276 has it. Nothing is public before the signature: a launch that stops before its card tells
  the owner so (`notice.launchStopped` with `private`).
- **The card.** `card.launch.writtenPicture` shows the picture's format, size in bytes, width and
  height in pixels and the first 16 digits of its digest, which the terms hash binds whole. No
  `card.launch.pinned` line.

## Consequences

- `Launcher` gains `pictureBytesFor`, `LaunchBuildRequest` `picture`, `DecodedLaunch` `picture`
  (`WrittenPicture`), the launch host `picturePlace` and `pictureBytesFor`, and the stored launch
  quote's picture its optional `width` and `height`. The chain package's fakes gain
  `createFakePictureLauncher`, and the launcher contract checks the picture a create call writes.
- The intent reasons gain `picture_too_large`, in both languages; spec 6 lists it, spec 1 says
  which upload such a launch reads, and spec 4 shows the new card line.
- A launchpad's limit can depend on the words because they share one field with the picture: a
  longer description leaves fewer bytes for it.

## Alternatives

- **A picture link, as decision 0276.** brew.family does not show one. Not chosen by the owner.
- **Deploy the picture as contract code first, as brew.family does.** A second transaction from the
  launch wallet that creates a contract, which the signer and the custody policy would have to
  allow, for pictures up to about 23 KB. Not chosen by the owner.
- **Shrink the owner's picture in the engine.** An image library in the engine for one launchpad;
  the owner uploads a picture that fits instead. Rejected.
