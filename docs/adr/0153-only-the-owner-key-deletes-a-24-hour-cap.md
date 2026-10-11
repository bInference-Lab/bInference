# 0153. Only the owner key deletes a 24-hour cap

Status: Accepted

Records what the Privy dev app answered on 2026-10-11; it makes no new choice.

## Context

[Decision 0149](0149-the-ceiling-bounds-what-stolen-keys-can-lose.md) and
[decision 0151](0151-the-owner-key-resizes-the-24-hour-caps-in-every-ceiling.md) say that Privy
deletes an aggregation with the app secret alone, so whoever holds the secret could make every
venue call and approval fail until the owner made the caps again.

On the Privy dev app, `DELETE /v1/aggregations/{id}` with the app's Basic auth and no other header
answered 401: "Missing `privy-authorization-signature` header or no signatures provided". Each
aggregation is owned by the owner key's quorum (`owner_id`), and Privy asks that owner to sign its
delete, as it does for a policy or a key quorum. The signed request is the one Privy's Node SDK
sends for `policies.delete`: method `DELETE`, the full URL, an empty body, and the `privy-app-id`
and `privy-request-expiry` headers, signed by the owner key. With that signature the delete
succeeded.

## Decision

- **Deleting a 24-hour cap needs the owner key.** The app secret alone cannot delete one, so a
  stolen machine cannot lift the caps or make every venue call fail through them.
- `deleteAggregation` takes the owner's authorization, as the wallet export does, and the fake
  Privy refuses a delete without it.
- The live custody suite signs its cleanup with the owner key it made.

## Consequences

- It corrects 0151's context and, through it, the consequence in 0149 that an app secret alone can stop every venue call through the caps no
  longer holds; deleting the policy or the wallet's rules still needs the owner key too.
- Aggregations a run made with an owner key it no longer has stay on the app; the dev app lost
  about four of its ten that way before this change.

## Alternatives

- **Leave 0149 and 0151 as they read.** They would keep telling the owner that the app secret alone
  can stop every venue call, which Privy refuses. Rejected.
