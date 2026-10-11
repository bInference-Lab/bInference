# 0145. A failed simulation of the chosen route ends the intent before risk

Status: Accepted

## Context

[Decision 0107](../DECISIONS.md#d0107) simulates every quote's plan while the quote step runs, and
says that with no plan passing, the priced venue's failed simulation ends the intent. The states
kept their order, so the risk check still ran on that fallback plan first: its sources and its
round trip were asked about a trade that could not run, and a risk refusal then replaced the
`simulation_reverted` or `effects_differ` reason the intent should end with. Wallets that simulate
before they sign block such a trade and show why. The owner chose this on 2026-10-11.

## Decision

- When the chosen route's simulation failed, the intent moves from `quoted` to `failed_check` on
  `simulation_failed` right after `quote_built`, with the simulation's own reason.
- The risk check runs only on a plan whose simulation passed.
- Spec 6 gains the row `quoted → failed_check` on `simulation_failed`; the row from `assessed`
  stays for a simulation that fails at its own step.

This amends decision 0107. Accepted by the owner on 2026-10-11.

## Consequences

- No risk source or round trip is asked about a trade that cannot run, and the owner reads the
  true reason.
- An intent that fails its simulation never holds a risk report.

## Alternatives

- **Keep the order and store the simulation's reason over the risk refusal.** The risk check would
  still spend its sources' quota on a trade that cannot run. Rejected.
- **Skip the risk step but pass through `assessed`.** It would record a risk check that never ran.
  Rejected.
