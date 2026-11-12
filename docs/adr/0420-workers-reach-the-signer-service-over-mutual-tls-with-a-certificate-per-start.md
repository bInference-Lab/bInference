# 0420. Workers reach the signer service over mutual TLS with a certificate per start

Status: Accepted

Accepted by the owner on 2026-11-12.

## Context

Only a worker may ask the signer service for a signature, and the service must know which worker
asks: it signs only for the worker that holds the install's lease (spec 3, section 6.5), whose rows
name a worker id unique per start. The workers and the service run in separate networks
([decision 0419](0419-the-signer-service-keeps-the-privy-key-in-a-sign-only-kms-key.md)). A worker
id the request body carries proves nothing.

## Decision

- Each worker start gets one client certificate from a private certificate authority that only
  the signer service trusts, valid for 24 hours at most. Its one URI name is
  `spiffe://binference.io/worker/<worker id>`, and that worker id is the one the worker writes in
  `agent_leases` as it takes an install.
- The authority issues a certificate only to a host of the workers' account, on the platform's own
  proof of the host's identity, and logs each one it issues.
- Every request is HTTPS over TLS 1.3 with the client certificate. The service takes the worker id
  from the verified certificate alone and refuses a connection without one before it reads a
  byte. The workers pin the service's own certificate authority.
- A worker that stops never comes back under its id: the next start takes a new id and a new
  certificate.

## Consequences

- A request names its worker by a key the worker holds, and the lease check compares that name
  with `agent_leases`.
- Revoking one worker is letting its certificate run out, or the authority's list of revoked
  certificates, which the service reads every minute.
- The workers' account can still mint certificates for any worker id; the lease check, not the
  certificate, decides which worker may sign for an install.

## Alternatives

- Signed requests (HTTP message signatures with an Ed25519 key per start): the service needs a
  registry of worker keys that something must write, and a worker could write its own.
- The cloud's own identity (requests signed with the host's role): fewer parts, but it ties the
  service to one provider and names a host, not a worker start.
- A shared bearer token: one leak lets anyone ask as any worker.
