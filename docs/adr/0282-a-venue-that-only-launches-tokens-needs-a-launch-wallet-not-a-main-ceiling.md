# 0282. A venue that only launches tokens needs a launch wallet, not a main ceiling

Status: Accepted

Accepted on 2026-10-20.

## Context

[Decision 0278](0278-brew-trades-in-its-pools-and-only-its-single-pair-factory-s-launches-count.md)
makes Brew a venue that trades nothing: its tokens trade in their pools through the aggregators.
It still launches tokens, from the launch wallet alone
([decision 0217](0217-a-launch-wallet-trades-on-launch-contracts-under-a-ceiling-of-its-own.md)),
and a launch names its venue, which the policy refuses unless the agent's limits name it
(`venue_off`). Two rules stood in the way:

- Only a launchpad, a venue with a curve read, kept a launcher when its plugin defined it.
- `limit/set` refuses a venue a live wallet's ceiling leaves out (`limit.over_ceiling`), and no
  main wallet's ceiling lists a call only a launch wallet makes
  ([decision 0271](0271-flap-launches-tax-tokens-through-the-portal-with-a-salt-found-off-line.md)).
  So a live agent could never add such a venue.

## Decision

- **Any venue may launch.** `defineVenue` checks and keeps a launcher as `defineLaunchpad` does, so
  a venue with no curve can launch tokens.
- **A venue that only launches.** The venue host names a venue that holds a launcher and no curve,
  every call it declares a launch wallet's alone, with no spender a main wallet approves
  (`launchesOnly`). `limit/set` treats it as it treats a launchpad whose trades call a launch's own
  contracts: a live agent needs its live launch wallet to add it (`limit.needs_launch_wallet`), no
  main wallet's ceiling is asked, and a paper agent adds it with no ceiling to check. The launch
  wallet's ceiling must still allow its create call, which a launch checks before its build
  (`ceiling_lacks_call`) and `binference check` reports (`wallets.launch_calls`).

## Consequences

- The venue host gains `launchesOnly`; `defineVenue` keeps `launcher`, and `defineLaunchpad` keeps
  it through `defineVenue`.
- An agent adds Brew to its venues once it has a launch wallet, with the 24-hour wait of any
  loosening.

## Alternatives

- **Make Brew a launchpad whose curve holds nothing.** A curve read on every buy and sale, for a
  venue with no curve. Rejected.
- **Exempt launches from the venue rule.** The venues are the owner's list of where an agent may
  act; a launch is one more place. Rejected.
