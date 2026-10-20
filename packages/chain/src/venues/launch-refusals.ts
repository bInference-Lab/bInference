/**
 * Why a launchpad cannot quote a launch now, each a step the owner can take (decision 0284):
 * `no_route`, it does not launch on the chain or against the pair; `launch_paused`, it has paused
 * new launches; `start_unpriced`, it would work out the starting market cap from the pair's USD
 * price, which binference lacks; `start_unreachable`, no starting price it can set fits the
 * starting market cap; `dry_run_failed`, the launch's own steps failed when run unsent at the
 * latest block.
 */
export const launchQuoteFailures = [
  "no_route",
  "launch_paused",
  "start_unpriced",
  "start_unreachable",
  "dry_run_failed",
] as const;

/** Why a launchpad cannot quote a launch now. */
export type LaunchQuoteFailure = (typeof launchQuoteFailures)[number];

/**
 * Why a launchpad does not take a launch's settings together, each a step the owner can take
 * (decision 0284): `recipient_needed`, the settings leave its fees to a fee recipient the launch
 * does not name; `recipient_unused`, they send its fees elsewhere, so a fee recipient the launch
 * names would never be paid.
 */
export const launchSettingsRefusals = ["recipient_needed", "recipient_unused"] as const;

/** Why a launchpad does not take a launch's settings together. */
export type LaunchSettingsRefusal = (typeof launchSettingsRefusals)[number];
