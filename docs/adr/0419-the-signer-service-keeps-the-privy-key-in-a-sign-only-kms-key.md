# 0419. The signer service keeps the Privy key in a sign-only KMS key

Status: Accepted

Accepted by the owner on 2026-11-12.

## Context

On bInference Cloud one signer service signs every Cloud wallet's transactions. Spec 5, section 1
names its key "our signer service's key, in KMS" and ARCHITECTURE.md section 30 calls the service
"the only holder of our Privy authorization key". Privy's authorization keys are P-256 ECDSA keys,
and Privy checks a DER signature over the SHA-256 of the request's payload (spec 5, section 5.1).
The root rules keep every outside provider behind a port.

## Decision

- The key is a P-256 signing key made inside the KMS, which signs SHA-256 digests and exports
  nothing private. The service reaches it through a port of its own, `SigningKey`: `publicKey`,
  `sign` (a digest in, a DER signature out) and `readBack` (what the provider reports of the key,
  its policy and its grants).
- The provider is AWS KMS: key spec `ECC_NIST_P256`, usage `SIGN_VERIFY`, origin `AWS_KMS`, one
  region, in an AWS account that holds only the signer service.
- The service has its own network: it takes connections only from the workers' network, on one
  port; it reaches only the KMS's private endpoint, Privy's API and the Cloud database; it has no
  public address. It connects to the database as `binference_signer` alone.
- The key policy allows and denies exactly this, in AWS's terms:

  | Who                                  | Allowed                                                                                                                                          | Denied                                                                                                                                          |
  | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
  | The service's runtime role           | `kms:Sign` with `ECDSA_SHA_256` on a `DIGEST`; `kms:GetPublicKey`, `kms:DescribeKey`, `kms:GetKeyPolicy`, `kms:ListGrants`                       | everything else                                                                                                                                 |
  | The key's break-glass role, with MFA | `kms:DescribeKey`, `kms:GetKeyPolicy`, `kms:PutKeyPolicy`, `kms:DisableKey`, `kms:EnableKey`, `kms:ScheduleKeyDeletion`, `kms:CancelKeyDeletion` | `kms:Sign` and every other use                                                                                                                  |
  | Every principal                      | nothing                                                                                                                                          | `kms:CreateGrant`, `kms:ReplicateKey`, `kms:UpdatePrimaryRegion`, `kms:ImportKeyMaterial`, and `kms:Sign` by any principal but the runtime role |

  The policy names no account root, so no IAM policy can widen it.

- At start, and every hour after, the service reads the key back before it signs: its spec, usage,
  origin and state; its policy, which must equal the list above statement by statement; its grants,
  which must be none; and its public half, which must equal the one in Privy's key quorum of the
  service's signer, read with the app secret. Any difference stops all signing: every request
  answers `locked` with `key_check` until a read matches again, and the service raises an alarm.

## Consequences

- A thief of the service's host can ask for signatures while the host runs, inside the hard
  rules, the user's sums and the ceiling, but never takes the key away.
- A changed key policy stops signing within an hour, or at once on a restart.
- A second provider is a second adapter of `SigningKey`, with the same read-back.

## Alternatives

- Google Cloud KMS, with protection level `HSM` and algorithm `EC_SIGN_P256_SHA256`: equal on the
  key, and a second adapter of `SigningKey` if one is ever needed; AWS comes first because its key
  policy reads back as one document the service can compare whole.
- An HSM of our own, or one rented by the hour: full control, but it needs hands to run it, and a
  Privy key in it signs no better.
- The key in the service's memory, sealed by a KMS data key: the key exists in a process, so a
  thief of the host takes it away.
