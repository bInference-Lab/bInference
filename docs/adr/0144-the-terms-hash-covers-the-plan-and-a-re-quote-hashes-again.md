# 0144. The terms hash covers the plan, and a re-quote hashes again

Status: Accepted

## Context

A card's terms hash covered the intent, the card version, the request and the quote. The plan,
the transactions that run, was not in it. A tap on a quote older than the re-quote age quotes and
simulates again, and a new minimum out within the tolerance confirms at once: the new quote and
plan replace the old ones, but the confirmation kept the card's hash of the old quote. The engine
then sent that hash with every signature of the new plan, so the signer's rule 5 compared one
engine value with another and bound nothing that runs (spec 6, invariant 2). The auto grant's
hash had the same gap. The owner chose on 2026-10-11 to hash the plan and hash again on a re-quote.

## Decision

- Every terms hash, a card's and an auto grant's, is the SHA-256 of the stable JSON of the intent,
  the card version or the mode version, the request, the quote and the plan.
- A re-quote within the tolerance at the tap hashes the new quote and plan under the card version
  the owner tapped, and the confirmation stores that hash, not the card's.
- The engine sends the confirmation's hash with every signature, so rule 5 checks the hash of
  exactly what runs.

Accepted by the owner on 2026-10-11.

## Consequences

- A confirmation's hash differs from its card's after a re-quote; the card keeps the hash of what
  it showed.
- A confirmation or an auto grant stored before the change keeps its old hash, which its own
  signatures still match; nothing is migrated.
- Spec 6, section 1 says what the hash covers. The known answer of the auto hash changes.

## Alternatives

- **Document that rule 5 only guards against mix-ups between intents.** The confirmation would
  still name terms that no longer run. Rejected by the owner.
- **Open card version n+1 on every re-quote.** A fresh quote within the tolerance would need a
  second tap, which spec 6 avoids on purpose. Rejected.
