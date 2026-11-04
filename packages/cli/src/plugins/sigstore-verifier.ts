import { err, type JsonValue, ok } from "@binference/core";
import { bundleFromJSON } from "@sigstore/bundle";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import { type Signer, toSignedEntity, toTrustMaterial, Verifier } from "@sigstore/verify";
import type { BundleVerifier, SignerIdentity } from "./npm-provenance.js";
import trustedRoot from "./sigstore-trusted-root.json" with { type: "json" };

// Fulcio's Source Repository URI extension, a DER UTF8String.
const sourceRepositoryOid = "1.3.6.1.4.1.57264.1.12";
const utf8StringTag = 0x0c;

// The text of a DER UTF8String, its length in the short form or in one or two bytes.
function utf8StringOf(value: Uint8Array): string | undefined {
  const bytes = Buffer.from(value);
  const first = bytes[1] ?? 0;
  const lengthBytes = first < 0x80 ? 0 : first - 0x80;
  if (bytes[0] !== utf8StringTag || lengthBytes > 2) {
    return undefined;
  }
  const length = lengthBytes === 0 ? first : bytes.readUIntBE(2, lengthBytes);
  const start = 2 + lengthBytes;
  return start + length === bytes.length ? bytes.subarray(start).toString("utf8") : undefined;
}

// The certificate's Source Repository URI, when it holds one.
function sourceRepositoryOf(signer: Signer): string | undefined {
  const source = signer.identity?.oids?.find(
    ({ oid }) => oid?.id.join(".") === sourceRepositoryOid,
  );
  return source === undefined ? undefined : utf8StringOf(source.value);
}

// What the signing certificate names, or none when it names no subject alternative name.
function identityOf(signer: Signer): SignerIdentity | undefined {
  const { identity } = signer;
  const signedBy = identity?.subjectAlternativeName ?? "";
  const issuer = identity?.extensions?.issuer;
  const sourceRepository = sourceRepositoryOf(signer);
  return signedBy === ""
    ? undefined
    : {
        signedBy,
        ...(issuer === undefined ? {} : { issuer }),
        ...(sourceRepository === undefined ? {} : { sourceRepository }),
      };
}

/**
 * Verifies npm provenance bundles with Sigstore's own verifier (decision 0348) against Sigstore's
 * public trust root as `@sigstore/tuf` 5.0.0 shipped it (`sigstore-trusted-root.json`): its
 * certificate authorities, transparency logs, certificate transparency logs and timestamp
 * authorities. Nothing leaves the machine, so a check needs no outside host and gives the same
 * answer each time. It needs one transparency log entry and one certificate transparency entry,
 * the verifier's defaults, and answers what the signing certificate names: its subject
 * alternative name (the build workflow), its OIDC issuer and its Source Repository URI extension.
 */
export function sigstoreVerifier(): BundleVerifier {
  const verifier = new Verifier(toTrustMaterial(TrustedRoot.fromJSON(trustedRoot)));
  return async (bundle: JsonValue, signal) => {
    signal.throwIfAborted();
    try {
      const identity = identityOf(verifier.verify(toSignedEntity(bundleFromJSON(bundle))));
      return Promise.resolve(identity === undefined ? err("unverified") : ok(identity));
    } catch {
      return Promise.resolve(err("unverified"));
    }
  };
}
