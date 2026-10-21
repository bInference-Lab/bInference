# 0289. A launch that ends unsigned tells the owner in its own words

Status: Accepted

Accepted by the tech lead on 2026-10-21.

## Context

[Decision 0109](0109-an-intent-whose-next-step-was-never-signed-ends.md) ends an intent whose next
step was never signed: `cancelled` with `notice.notSigned` when no step was signed, and
`failed_onchain` with `step_unsent` and `notice.stepUnsent` once an earlier step landed. Recovery
never signs.
[Decision 0241](0241-a-failed-launch-may-keep-its-exact-approval-and-the-engine-alone-holds-the-launch-wallet-rule.md)
lets a failed launch keep its exact approval.

The crash suite
([decision 0287](0287-the-crash-suite-launches-flap-tokens-on-stand-ins-of-the-bare-chain.md))
reaches both ends for a token launch: a stop after the tap and before the create call is signed,
and a stop between a token pair's approval and its create call. The owner then reads "A trade was
cancelled" or "A trade stopped part way ... Check the wallet". Neither says it was a launch, that
no token was made, that its picture and words may already be public on the launchpad, that the
launchpad may still spend the approved amount, or what to do next.

The approval reset of
[decision 0211](0211-a-live-fill-holds-its-line-while-watched-and-leaves-no-approval-behind.md)
signs one more step under a live fill's grant while the fill runs. A launch has no grant past its
confirmation, and after a stop recovery signs nothing, so that path does not cover it.

## Decision

- **The rule stays.** A launch ends as decision 0109 says, and keeps its exact approval as
  decision 0241 says. Nothing is signed after a stop.
- **Its own words.** A launch that ends with no step signed sends `notice.launchNotSigned`: the
  launch of its symbol on its launchpad stopped after the owner confirmed it, no token was made,
  nothing was sent, whether its picture and words may already be public, and that the owner may
  propose it again. One that ends once its approval landed sends `notice.launchStepUnsent`: the
  same, and that the launchpad may still spend the approved amount from the launch wallet until a
  new launch sets that approval again.
- **The approval is told, not reset.** The notice names the amount; no reset is signed.
- **Public or not** follows the launch's stored quote: a launch that uploaded its picture and
  words, as Flap's does before its pin, may have made them public.

## Consequences

- The owner learns from the notice alone that the token was not made and how to start again.
- Spec 4 gains `notice.launchNotSigned` and `notice.launchStepUnsent` in English and Chinese, and
  spec 6 names them.
- An exact approval stays on the launch wallet until the owner launches again or changes it.

## Alternatives

- **Reset the approval at recovery.** It signs after a stop without a confirmation in force,
  which decision 0109 refuses. Rejected.
- **Keep the trade notices.** They name no launch, no token and no public picture. Rejected.
