# 0284. A launchpad names why it refuses a launch

Status: Accepted

Accepted on 2026-10-20.

## Context

A launchpad's quote could refuse a launch only as `no_route`, whose words tell the owner to try a
smaller amount or another token, and its own check of the settings
([decision 0280](0280-a-launch-setting-may-be-an-amount-of-the-pair-left-for-the-launchpad-to-work-out.md))
only with a no, which reads as `protocol.bad_args`. A launch that a dry run refuses threw, which
reads as a launchpad that is down. On Brew
([decision 0283](0283-brew-launches-a-token-into-a-1-pool-from-the-launch-wallet.md)) each of
these has a plain next step the owner never saw: set a starting market cap, wait until launches
resume, pick another start, try a smaller first buy, or name a fee recipient.

## Decision

- **Quote refusals.** A launcher's quote may refuse with `launch_paused` (new launches are
  paused), `start_unpriced` (it works out the starting market cap from the pair's USD price, which
  binference lacks), `start_unreachable` (no starting price it can set fits the starting market
  cap) or `dry_run_failed` (the launch's own steps failed when run unsent at the latest block),
  beside `no_route`. The engine ends the launch `failed_check` with the same reason, before any
  upload, and each reason's words name the owner's next step in English and Chinese.
- **Settings refusals.** A launcher's `checkOptions` may answer `recipient_needed` (the settings
  leave its fees to a fee recipient the launch does not name) or `recipient_unused` (they pay its
  fees elsewhere, so a named fee recipient would never be paid) in place of a no. A request with
  either fails with `intent.launch_recipient_needed` or `intent.launch_recipient_unused` and
  stores nothing; any other no stays `protocol.bad_args`. Values the quote or the build works out
  that the launchpad refuses with either stay `decode_mismatch`.

## Consequences

- The chain package gains `LaunchQuoteFailure` and `LaunchSettingsRefusal`; the protocol two
  error codes; the intent four check reasons. Specs 1 and 6 say so.
- Launchpads that refuse only with `no_route` and a no work as before.

## Alternatives

- **Words of each launchpad's own, as its card warnings
  ([decision 0281](0281-a-launchpad-may-show-warnings-of-its-own-on-every-launch-card.md)).**
  An error carries a code, not a launchpad's message, so every surface would need a new way to
  show one. The four reasons and two errors fit any launchpad that sets a start, pauses, dry runs
  or pays a fee recipient. Rejected for now.
