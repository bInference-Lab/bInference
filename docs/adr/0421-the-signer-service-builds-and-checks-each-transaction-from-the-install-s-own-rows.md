# 0421. The signer service builds and checks each transaction from the install's own rows

Status: Accepted

Accepted by the owner on 2026-11-12.

## Context

The self-hosted signer takes its `authorize` request from the engine: the Privy request, the
step, the authorization, the terms hash and the allowed set (spec 5, section 5.1). It checks them
against each other and its own clock, so against a compromised engine a forged auto grant or
fill grant adds no wall (spec 5, section 5.2, rule 5). On bInference Cloud the engine runs in a
worker, which shares hosts with other users' agents, and the signer service can read the install's
schemas itself. A worker's role cannot insert a confirmation (spec 3, section 6.6), but it writes
intents, their grants and the approval modes. A worker that lost its lease must get no signature.

## Decision

- **The request names, it never describes.** A worker sends the install, the fence it holds, the
  intent, the step, the authorization's kind and id, and the transaction's place: its nonce, gas
  limit and fees, and whether it is a speed-up or a cancel. It sends no transaction bytes, terms
  hash, allowed set or grant.
- **The service checks, in one serializable transaction:** the breaker; the lease (rows exist, each
  names the certificate's worker and the request's fence, and none expired at the database's clock);
  the intent (live, `executing`, its wallet); the authorization, read from the install's own rows;
  and it builds the transaction from the intent's stored plan step and the request's place.
- **The authorization holds only on rows a worker cannot forge alone.** A confirmation is its row,
  which only the ingress writes, and the terms hash the service works out again from the intent's
  stored request, quote, plan and card version must equal it. A fill grant, stored by the worker,
  holds only while its source's own confirmation row carries the grant's source terms hash and the
  source is in force. An auto grant holds only while the agent's `approval_modes` row says `auto`,
  which only the ingress can set, and the terms hash worked out again equals the grant's.
- **The same hard rules,** from the public `signer` package, run on what the service built, with
  an allowed set the service works out from the registry, the venues' declarations of the release
  it runs and the confirmed plan.
- **The lease is read twice.** After Privy answers, the service reads the lease again; a worker
  that lost it gets `lease_lost` and not the signature, which no one else ever receives.
- **Roles.** `binference_signer` also reads `approval_modes` and `webhook_rules`, and in the
  shared schema `agent_leases` and `breaker`, with a plain read and no lock. A trigger on
  `approval_modes` refuses a move from `manual` to `auto` for any role but the ingress.

## Consequences

- A compromised worker cannot make the service sign a plan the user did not confirm, a fill of an
  order the user never confirmed, or anything once auto mode is off. Inside auto mode or a
  confirmed order it can still choose trades, which the hard rules, the user's sums
  ([decision 0422](0422-each-cloud-user-s-24-hour-sums-are-reserved-before-the-key-signs.md)) and
  the ceiling bound.
- The service runs the terms hash, the plan's step format and the allowed set from the same public
  packages as the workers, at the same release. The `signer` package exports its rule check for it.
- A lease lost between the second read and the worker's own write of the signed transaction is
  caught by the worker's store, whose fence refuses that write.

## Alternatives

- The self-hosted request, sent by the worker: every fact the rules check comes from the worker,
  so a compromised worker forges any grant.
- The worker sends the unsigned transaction and the service compares it with the plan: the same
  checks, plus parsing a worker's bytes, a wider surface for no gain.
- The lease rows read `FOR SHARE`: it needs `UPDATE` on `agent_leases`, and no lock can span the
  call to Privy, which runs outside the transaction.
