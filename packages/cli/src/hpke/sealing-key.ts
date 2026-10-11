import { hkdfSync, type KeyObject } from "node:crypto";
import { type P256KeyPair, p256KeyPairFromScalar } from "@binference/signer";
import { ownerKeyRecipient } from "../backups/owner-key-recipient.js";
import type { HpkeRecipientKey } from "./hpke-seal.js";

/** The P-256 key pair that backups are sealed to, derived from the owner key. */
export interface SealingKey {
  /** Its private half as HPKE opens with it; it lives only as long as the owner key does. */
  readonly recipient: HpkeRecipientKey;
  /** Its public half as DER SubjectPublicKeyInfo in base64, which the install keeps. */
  readonly publicKey: string;
}

/**
 * The `info` of the HKDF step: it names the key's one purpose and its version, so no other key
 * ever derived from the owner key shares its bytes.
 */
export const sealingKeyInfo = "binference sealing key v1";

const scalarBytes = 32;
const noSalt = new Uint8Array(0);
// RFC 9180, section 4: every label starts with the version, then the KEM's suite id,
// "KEM" || I2OSP(kem_id, 2), with 0x0010 for DHKEM(P-256, HKDF-SHA256).
const labelPrefix = Buffer.concat([Buffer.from("HPKE-v1KEM"), Buffer.of(0x00, 0x10)]);

/**
 * The input keying material of the sealing key: HKDF-SHA256 (RFC 5869) over the owner key's
 * 32-byte private scalar, with no salt and {@link sealingKeyInfo} as `info`, 32 bytes long. The
 * caller zeroes it once the key pair is derived.
 */
export function sealingKeyMaterial(ownerScalar: Uint8Array): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", ownerScalar, noSalt, sealingKeyInfo, scalarBytes));
}

/**
 * RFC 9180's DeriveKeyPair for DHKEM(P-256, HKDF-SHA256) (section 7.1.3): `dkp_prk` is
 * LabeledExtract("", "dkp_prk", ikm), then each candidate is LabeledExpand(dkp_prk, "candidate",
 * counter, 32), taken as a big-endian scalar, until one is a valid P-256 private key. One HKDF
 * call computes Extract then Expand with the labeled input and info, which is that pair of steps.
 * Answers the key pair of the first valid candidate.
 */
export function deriveP256KeyPair(ikm: Uint8Array): P256KeyPair {
  const labeledIkm = Buffer.concat([labelPrefix, Buffer.from("dkp_prk"), ikm]);
  try {
    for (let counter = 0; counter < 256; counter += 1) {
      const info = Buffer.concat([
        Buffer.of(0x00, scalarBytes),
        labelPrefix,
        Buffer.from("candidate"),
        Buffer.of(counter),
      ]);
      const candidate = new Uint8Array(hkdfSync("sha256", labeledIkm, noSalt, info, scalarBytes));
      const pair = p256KeyPairFromScalar(candidate);
      candidate.fill(0);
      if (pair.ok) {
        return pair.value;
      }
    }
  } finally {
    labeledIkm.fill(0);
  }
  // 256 candidates at or above P-256's order, each with a chance under 2^-32, never happen.
  throw new RangeError("No P-256 scalar among 256 candidates.");
}

function scalarOf(ownerKey: KeyObject): Buffer {
  const { d } = ownerKey.export({ format: "jwk" });
  return Buffer.from(d ?? "", "base64url");
}

/**
 * Derives the sealing key from the owner key (keys spec, section 7.2): HKDF-SHA256 over its
 * private scalar with an `info` of its own, then RFC 9180's DeriveKeyPair for DHKEM(P-256,
 * HKDF-SHA256) on that, which maps the bytes to a valid scalar. The owner key itself only signs
 * Privy requests with ECDSA; the sealing key only opens what HPKE sealed to it, so neither key
 * serves two primitives. The same owner key always derives the same sealing key, and nothing of
 * the owner key can be learned from it. The scalar and the keying material are zeroed after.
 */
export function deriveSealingKey(ownerKey: KeyObject): SealingKey {
  const scalar = scalarOf(ownerKey);
  const material = sealingKeyMaterial(scalar);
  try {
    const pair = deriveP256KeyPair(material);
    return { recipient: ownerKeyRecipient(pair.privateKey), publicKey: pair.publicKey };
  } finally {
    scalar.fill(0);
    material.fill(0);
  }
}
