# 0434. A plugin listing is signed with Ed25519 over a statement of its kind, key and digest

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

[Decision 0433](0433-on-cloud-a-plugin-installs-turns-on-and-runs-only-under-a-listing-binference-signed.md)
checks a plugin listing on each Cloud worker before an install, an enable and a start, and
[decision 0435](0435-a-signed-revocation-list-stops-a-revoked-plugin-and-a-stale-one-holds-every-listed-plugin.md)
checks a revocation list. The listing catalog on binference.io signs both with a listing key in a
KMS, which never lets the private half out; the worker verifies with the public half alone,
through `node:crypto`. The catalog and the worker are two codebases, so the bytes signed must
follow one fixed encoding that both write the same way, never the order in which an object's keys
were set. One key must be able to replace another with no moment when nothing verifies.

AWS KMS offers these asymmetric signing key specs, by its developer guide's "Key spec reference"
and its API reference for `Sign` (docs.aws.amazon.com, read on 2026-11-13): `RSA_2048`,
`RSA_3072` and `RSA_4096` (RSASSA-PSS and PKCS #1 v1.5 with SHA-256, SHA-384 or SHA-512);
`ECC_NIST_P256`, `ECC_NIST_P384` and `ECC_NIST_P521` (ECDSA); `ECC_SECG_P256K1` (ECDSA with
SHA-256); `ECC_NIST_EDWARDS25519` (`ED25519_SHA_512` with `MessageType` `RAW`, and
`ED25519_PH_SHA_512` with `DIGEST`); `ML_DSA_44`, `ML_DSA_65` and `ML_DSA_87`
(`ML_DSA_SHAKE_256`); and `SM2`, in China Regions only. `Sign` takes a message of at most 4,096
bytes. Node 26's `node:crypto` verifies Ed25519, ECDSA, RSA and ML-DSA.

[Decision 0429](0429-a-listed-mcp-tool-runs-only-as-its-listing-pins-it.md) gives an MCP listing
the id `mls_` and a UUIDv7, and a `version` that rises with each reviewed change. Core's
`stableJson` already writes a JSON document with its keys sorted, as the ledger's and the fill
terms' hashes use it.

## Decision

- **One listing, one package version.** A plugin listing names one npm package at one exact
  version. Its id is `pls_` and a lowercase UUIDv7. Its `version`, a positive integer, rises each
  time the catalog signs the listing again after a reviewed change, as an MCP listing's does. A new
  version of the package gets a listing of its own. The catalog serves every listing it has not
  revoked, and at most one listing id for one package version; two are a `bad_answer`.
- **The listing's fields,** its payload, each one required unless marked:

  | Field                                   | What it holds                                                                                                                    |
  | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
  | `kind`                                  | `pluginListing`                                                                                                                  |
  | `listing`, `version`                    | Its id and its version, as above                                                                                                 |
  | `issuedAt`                              | When the catalog signed it, in epoch milliseconds                                                                                |
  | `packageName`, `packageVersion`         | The npm package and its exact version, as `plugin/add`'s source names them                                                       |
  | `integrity`                             | The tarball's npm integrity, `sha512-` and the base64 digest                                                                     |
  | `files`                                 | The SHA-256 pin of its files, in hex, as decision 0348 makes it                                                                  |
  | `plugin`                                | Its manifest's id                                                                                                                |
  | `provenance`                            | `verified` or `none`                                                                                                             |
  | `publisher`, `issuer`, `workflow`       | Optional, each as the plugin lock stores it; `issuer` and `workflow` only with `verified`                                        |
  | `kinds`, `hosts`, `tools`, `configKeys` | What the manifest declares, as the permission review shows it: each list sorted, each entry once, within `communityPluginLimits` |

  The install compares every field but `kind`, `listing`, `version` and `issuedAt` with what it
  fetched (decision 0433).

- **The canonical bytes.** A payload is the UTF-8, with no byte-order mark, of core's
  `stableJson` of its fields: keys sorted by UTF-16 code units, no spaces, each string as JSON
  writes it, and each number a whole number below 2^53 written in digits. For these values that is
  the canonical form of RFC 8785. The verifier parses the payload, writes it again the same way,
  and refuses it unless the bytes are equal, so a payload with a byte-order mark, a repeated key, a
  space or a value written another way never reads two ways.
- **The envelope,** the text the catalog serves: `{ "key", "payload", "signature" }`. `key` is the
  signing key's id; `payload` is the canonical bytes in base64url (RFC 4648 section 5, no padding);
  `signature` is the 64-byte Ed25519 signature in base64url. Each base64url text must be the one
  that writes its bytes. A listing's payload holds at most 64 KiB, a revocation list's 1 MiB.
- **What is signed** is a statement, never the payload itself: the ASCII text
  `binference-listing-v1`, a zero byte, the kind (`pluginListing` or `pluginRevocations`), a zero
  byte, the key's id, a zero byte, then the 32-byte SHA-256 of the payload. It is at most 105
  bytes, inside the 4,096 that `Sign` takes. The verifier builds the statement from the kind it
  asked for, so a revocation list's signature never verifies a listing, and the payload's own
  `kind` must match it too. The key's id is inside, so a signature names the one key that made it.
- **The algorithm** is Ed25519 (RFC 8032), from a KMS key of spec `ECC_NIST_EDWARDS25519` and
  usage `SIGN_VERIFY`, signed with `ED25519_SHA_512` and `MessageType` `RAW`. The worker verifies
  with `crypto.verify(null, statement, key, signature)` of `node:crypto` alone. It makes each key
  once with `createPublicKey` from its SubjectPublicKeyInfo DER, as KMS's `GetPublicKey` answers
  it, and refuses the composition unless the key's `asymmetricKeyType` is `ed25519`.
- **A key's id** is the first 16 bytes of the SHA-256 of its SubjectPublicKeyInfo DER, in
  lowercase hex: 32 characters. The worker computes it from each key it holds; the catalog names
  it in each envelope.
- **The keys in force.** The root hands 1 to 4 public keys, constants of the Cloud worker's
  deploy; two keys with one id refuse the composition. An envelope verifies only under the key its
  `key` names, and only while that key is in force. Staging and production sign with keys of their
  own, so a staging listing never verifies on a production worker.
- **Rotation,** with no moment when nothing verifies: make the new KMS key; deploy the workers
  with both public keys; let the catalog sign every listing it serves, each at its next `version`,
  and its next revocation list with the new key; once every worker runs that deploy, deploy with
  the new key alone; then disable the old KMS key and schedule its deletion. A deploy starts every
  worker again, so every installed listing is checked again under the new set (decision 0433). A
  key that leaked leaves the set at the next deploy, and the next revocation list, signed with a
  key still in force, names every listing it signed that bInference did not mean.
- **A recorded vector.** `packages/cli/src/plugins/recorded/listing-vector.json` holds only a
  test key's public half (its SubjectPublicKeyInfo DER in base64url), a listing envelope and a
  revocation list envelope that key signed, and the key id and statements expected of them. No
  private key is in the repository, not even a test seed: every other test makes its Ed25519 keys
  with `node:crypto` as it runs. The install's tests verify the vector. Ed25519 is deterministic,
  so the catalog's repository, which keeps its own copy of the test key, proves that its signer
  writes the same bytes.

## Consequences

- A listing or a list whose bytes changed after signing, signed by a key out of the set, or
  written in a second form never verifies.
- A check needs no secret on the worker and no network beyond the catalog's answer: the public
  keys ship with the deploy.
- Rotating a key costs two deploys and one pass of the catalog signing again; a leaked key costs
  one deploy and a revocation list.
- Ed25519 does not stand up to a large quantum computer. A move to `ML_DSA_65`, which KMS offers
  and Node verifies, is a new key kind and a new decision; the envelope keeps its form.
- The catalog's own spec writes the KMS key's policy: only its signing role signs, and only with
  `ED25519_SHA_512`.
- The envelope suits an MCP listing too, under a kind of its own; whether the Cloud root checks
  MCP listings this way comes with that root.

## Alternatives

- **ECDSA on `ECC_NIST_P256`, as the signer service's key.** KMS answers it in DER, and both
  `(r, s)` and `(r, n-s)` verify, so one statement has two signatures; Ed25519 has one form of 64
  bytes.
- **`ED25519_PH_SHA_512` over a digest.** KMS hashes the digest it is given again, so the worker
  would verify HashEdDSA over a hash of a hash; the statement keeps pure Ed25519 on both sides.
- **Sign the payload itself.** A listing at its limits passes the 4,096 bytes `Sign` takes; the
  statement signs its SHA-256 instead.
- **`ML_DSA_65` now.** Signatures of 3,309 bytes, and Node's support is new; the envelope lets a
  later decision add it.
- **Sign `JSON.stringify` of the object.** Its bytes follow the order in which the keys were set,
  which the catalog's code and the worker's need not share.
- **JWS or COSE.** Each carries header choices to check, the algorithm among them; a fixed
  statement leaves nothing to choose.
- **A key id the catalog picks, such as a name.** The worker could not check it; an id made from
  the key it can.
- **One listing per plugin, its versions inside.** Revoking one version would need a revocation of
  a part of a listing; one listing per version is revoked by its id.
