# 0271. Flap launches tax tokens through the Portal with a salt found off line

Status: Accepted

Accepted by the owner on 2026-10-20.

## Context

[Decisions 0234](0234-a-token-launch-waits-in-quoted-for-its-pin-and-signs-from-the-launch-wallet.md)
to [0241](0241-a-failed-launch-may-keep-its-exact-approval-and-the-engine-alone-holds-the-launch-wallet-rule.md)
give each launchpad a launcher: it declares its settings, quotes from its contracts, uploads and
pins through the launchpad's own API, builds a create call to its registry contracts, names the
token before the call runs, and decodes every setting back from the bytes. Flap's developer docs
("Launch token through Portal", "Pin Existing IPFS Content", "Tax Token V3") and the Portal read on
BNB Smart Chain on 2026-10-20 (v5.25.0) say:

- `newTokenV6` launches a Tax Token V3 (`tokenVersion` 6), the type the docs recommend. A standard
  token through `newTokenV6` reverts with `FeatureDisabled`; standard tokens now go through
  `newTokenV7`, a different call.
- Each tax rate is 0 or from 100 to 1,000 basis points, and at least one is not 0
  (`InvalidTaxBps`). A tax lasts at most 100 years. A tax token must use the V2 migrator. The
  marketing, burn, dividend and liquidity shares add up to 10,000; a dividend share needs a minimum
  balance and a dividend token.
- The token's address comes from CREATE2: the Portal, the salt and a minimal proxy of the Tax Token
  V3 implementation. The Portal takes a tax token only at an address that ends in `7777`.
- The Portal takes no launch fee: the call succeeds with a value of exactly the coin first buy.
  Against USDT or USD1 it pulls the first buy by `transferFrom`, and the dividend token must be the
  pair.
- The upload API (`POST https://funcs.flap.sh/api/upload`, a GraphQL multipart request with the
  picture and the `MetadataInput` words) stores both on IPFS, pins them on Flap's storage, and
  answers the metadata's CID, which the create call names as `meta`. The pin status API (`GET
https://funcs.flap.sh/api/v1/ipfs/pins?cid=`) answers `queued`, `retrieving`, `processing`,
  `pinned`, `failed` or `not_found`. A read of a fresh CID through Flap's IPFS gateway before Flap
  holds it leaves the CID refused there for good, and the token shows no picture on Flap.

One live test upload on 2026-10-20, allowed by the owner, sent a 1x1 PNG with the words
"binference test upload, no token", no links and the zero address as `creator`, then read its pin
status once; no gateway was read. Flap took the multipart request as the client writes it, and the
null links and the zero address. Its answers differ from the docs' examples in three ways: the
upload answers `application/json` with no charset; the pin status names no `jobId` and adds the
pinned file's `name`, `sizeBytes`, `numberOfFiles`, `pinnedAt` and `alreadyPinned`; and the first
status read, a moment after the upload, was already `pinned`, with `providerStatus` `pinned` too.

## Decision

- **What a launch is.** The `flap` launcher launches Tax Token V3 tokens through `newTokenV6` on
  the registry's Portal, against the chain's coin or a quote token the registry lists for Flap's
  curves (on BNB Smart Chain, USDT and USD1), with the first buy in the create call
  ([decision 0270](0270-a-launch-s-first-buy-may-carry-no-minimum-when-it-runs-inside-the-create-call.md)).
  The venue declares `newTokenV6` as a call of the Portal, beside `swapExactInput`.
- **Its settings.** `buyTaxBps` and `sellTaxBps` (each at most 1,000), `taxRecipient`, `taxDays`
  (1 to 36,500) and `burnShareBps` (default 0); every other share goes to the tax recipient. Only
  the burned share has a default: no tax, recipient or length is picked for the owner. A rate from
  1 to 99 basis points, or no tax on either side, is refused before any dry run
  (`flap.bad_settings`).
- **What every launch writes.** The migration threshold Flap names as its default (80% of the
  supply sold), the V2 migrator, the chain's first DEX, no extension, no permit, no dividend or
  liquidity share, no anti-farmer wait and no commission receiver. The decoder reads a call as
  Flap's only when the venue would write the same bytes for what it reads.
- **The quote.** The launcher runs the launch's own steps unsent on the chain's simulator, with a
  salt found for the run and a stand-in for the metadata, from a wallet that holds only the first
  buy's spend. A call that succeeds with no value beyond the coin first buy shows the fee is 0; the
  first buy's output is what the wallet receives of the new token. A dry run that reverts throws.
- **The salt.** Found off line for each quote and each build: 32 random bytes from the `Random`
  port, counted up and hashed as CREATE2 does until the address ends in `7777`, at most 2^21 tries.
  One try in 65,536 hits, so a search takes about 30 ms on Node's own Keccak-256, and none found,
  about 1 in 10^14, throws `flap.no_salt`: the launch ends as a build that failed, and the owner
  launches again.
- **The upload and the pin.** `pin` uploads through the upload API, with the description, the
  website, X and Telegram links, and the launch wallet as `creator`, and answers the metadata's CID
  without waiting. `pinStatus` reads only the pin status API: `pinned` is pinned, `failed` is
  failed, and the others, `not_found` among them, are pending until the engine's 5 minute wait
  ends. Nothing in the plugin reads an IPFS gateway. Each failure of the API has its own outcome
  (`too_large`, `rate_limited`, `refused`, `unavailable`, `bad_answer`) and throws
  `flap.api_<outcome>`. The upload has 10 s of the host's 12 s, a status read 4 s of its 5 s.
- **The create call is the launch wallet's alone.** Flap marks `newTokenV6` as a call only a launch
  wallet makes (`isLaunchWalletOnly`), as the owner's rulings require: the agent's main wallets keep
  to known contracts and functions, and launches run from the launch wallet alone (decisions 0217,
  0218 and 0236). Only a launch wallet's ceiling allows it; an agent wallet's leaves it out. The
  engine names such calls to the signer by their JSON ABI entries, and the signer refuses one from
  any other wallet by its selector, and every call when an entry's selector cannot be read.
- **An older ceiling is caught before the upload.** A launch whose launch wallet's ceiling, as last
  read back, lacks a call only a launch wallet makes on its launchpad ends `ceiling_lacks_call`
  before anything is uploaded, with words that name `binference ceiling set` and the owner key. A
  ceiling set that adds or removes a function on the same contracts is journaled, pushed and
  announced as a change of the venues.
- **The decoder refuses what the builder refuses.** A create call is Flap's only when the venue
  would write the same bytes, with no bytes after them, and its settings are ones the builder
  takes.
- **The salt search yields.** It hands the event loop back and reads its signal every 65,536 tries,
  and uses viem's Keccak-256 when Node's OpenSSL has none.
- **The metadata's CID is taken from Flap's answer.** No Flap API returns the metadata without a
  gateway read, which the pin rule forbids, and Flap's server writes the metadata JSON, so its CID
  cannot be computed ahead. The card shows the CID and the picture's own digest, the terms hash
  binds both, and no money moves on them; a mismatch shows on Flap's site after the launch.
- **No commission.** Flap's commission receiver stays unset: binference takes no share of a
  launch's tax (the owner, 2026-10-20).
- **Tax tokens only, for now.** Standard tokens with no tax and dividend shares come later, each
  with its own decision (the owner, 2026-10-20).
- **The creator is the launch wallet.** The metadata names the launch wallet that makes the token
  as its `creator` (the lead, 2026-10-20).
- **`binference check` warns about an older ceiling.** A launch wallet whose ceiling lacks a call
  a launchpad the agent uses declares, such as `newTokenV6` on an install made before this change,
  is named in a warning in English and Chinese with its fix: `binference ceiling set` with the
  owner key, which writes the ceiling again from the venues' declarations (the lead, 2026-10-20).

## Consequences

- A Flap launch's card shows every setting in both languages: `launch.option.buyTaxBps`,
  `sellTaxBps`, `taxRecipient`, `burnShareBps` and `taxDays`.
- A ceiling made before this change lacks `newTokenV6`, so Privy refuses a launch from that
  install's launch wallet until the owner key changes the ceiling; `binference check` says so.
- Standard tokens with no tax and dividend shares are not offered. Each needs its own decision:
  `newTokenV7` for standard tokens, a minimum balance and a dividend token for dividends.
- `wallet/list` marks a launch wallet's missing calls (`WalletView.missingCalls`), and `check`
  gains `wallets.launch_calls`.
- `VenueCall` gains `isLaunchWalletOnly`, the signer's allowed set gains `launchOnlyCalls`, a
  ceiling's read-back names its call functions, and the check reasons gain `ceiling_lacks_call`.
- A change of the Portal's rules shows first as a dry run that reverts, so the launch fails before
  any upload.
- The plugin's tests answer with the live upload's recorded request bytes and answers, so a change
  in the client's request shows as a failing test. The status reader reads only `data.cid` and
  `data.status`, so the extra fields change nothing; the engine still waits for `pinned` across
  restarts, since an upload need not pin as fast as the test one did.

## Alternatives

- **Read the gateway to check the upload.** It can break the picture for good. Rejected.
- **Wait in `pin` until Flap pins.** The engine's pin wait does that across restarts (decision
  0234). Rejected.
- **Compute the first buy from the curve's formula.** Flap's docs advise against copying its curve
  parameters, and the fee and tax change the result; the dry run runs the Portal itself. Rejected.
- **Keep salts found ahead of time.** A list can run out, and a salt in the source is one anyone
  can take first. Rejected.
