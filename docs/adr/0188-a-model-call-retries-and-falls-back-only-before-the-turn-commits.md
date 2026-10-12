# 0188. A model call retries and falls back only before the turn commits

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 8](../specs/runtime.md) section 8.2 gives each failure class its next step: a `transient`
failure tries the same model up to 2 more times, after `Retry-After` or `Retry-After-Ms` (at most
60 s), else after 1 s then 4 s, then the next model of the role while the provider rests
`models.cooldownMs`; `auth`, `billing` and `request` go to the next model; `context`, `refused` and
`aborted` do not. One call makes at most 4 attempts, nothing retries or falls back once the turn is
committed, a model the owner picked never falls back, and a fallback lasts for the turn. Section 8.1
aborts a call with no event for `models.idleTimeoutMs`. Some cases are left open:

- **A longer wait.** A provider may ask for more than 60 s, as a 429 or a 503 can.
- **Every provider resting.** The chain may hold no model whose provider rests no longer.
- **A failed attempt's output.** A stream may fail after some text or calls.
- **Which rests.** The table rests a provider after a `transient` failure only.
- **Silence.** The clients' own timeout covers only the time to the answer's headers.
- **Compaction** (section 7.3) does not exist yet, and `context` is retried only after it.

## Decision

- **The chain.** Each turn calls a `ModelChain` port: the role's model, then
  `models.fallbacks.<role>` in order, each with its own transport; a model the owner picked stands
  alone. The runtime keeps one map of provider rests, which every turn's chain shares, so a rest
  outlives the turn that began it. A rest covers every model of its provider (the part of
  `<provider>/<model>` before the first slash) and never shortens one already running.
- **One call.** The turn calls its current model, or the first one after it whose provider does
  not rest. When every one rests, it calls its current model anyway. A transient failure waits as
  the provider asked when that is at most 60 s, else 1 s then 4 s, and tries the same model again,
  twice at most. After that, or at once when the provider asked for more than 60 s, the provider
  rests for `models.cooldownMs` or for the wait it asked, the longer, and the next model that does
  not rest takes over. `auth`, `billing` and `request` take the next model at once, with no rest. No
  next model, the fourth attempt, a committed turn, `context`, `refused` and `aborted` end the call
  with the last failure. A stop or the turn's time limit ends a wait, and the turn ends as a stop
  does. A fallback lasts for the turn; the next turn starts at the role's first model.
- **Only the answer counts.** What a failed attempt wrote is dropped: the transcript and the next
  call hold only the attempt that answered, or the last one.
- **Silence.** Every attempt runs an idle timer of `models.idleTimeoutMs` that every event resets,
  from the call's start, so a provider that stops sending in the middle of an answer is cut as
  surely as one that never starts. A cut attempt is a `transient` failure.
- **Context.** Until compaction lands, a `context` failure ends the call and the turn.
- **Usage.** Each attempt's usage is left to the budget's records (section 8.3).

## Consequences

- A busy provider gets the wait it asked for, and a provider that keeps failing is left alone for
  the cooldown by every turn, not only the one that saw it fail.
- A turn that proposed never calls a model again, so nothing it proposed can be proposed twice by a
  retry or another model.
- An owner's picked model is retried on a passing fault but never swapped.
- A call takes at most 4 attempts and 5 s of waits, or up to 2 minutes when providers ask for their
  longest waits, within the turn's 10 minutes.

## Alternatives

- **Wait up to 60 s when a provider asks for longer.** It would call again before the provider said
  it would answer. Rejected for the next model.
- **Fail when every provider rests.** A turn would end without a call while a rest might already be
  needless. Rejected.
- **Keep a failed attempt's text in the transcript.** The model would read half an answer, and some
  providers refuse a request that ends on the model's own words. Rejected.
- **Retries in each transport.** A transport sees one request, not the turn: it cannot tell a
  committed turn, keep a fallback for the turn, or share rests. Rejected for one step of the loop.
- **Rest a provider after `auth` or `billing` too.** Spec 8 rests only after a passing fault, and a
  refused key fails at once, at no cost. Rejected.
