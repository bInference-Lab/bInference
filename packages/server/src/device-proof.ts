import { Buffer } from "node:buffer";
import { createPublicKey, type KeyObject, verify } from "node:crypto";
import type { DeviceRecord } from "@binference/engine";
import { deviceProofText } from "@binference/protocol";

/** A console device's answer to a challenge, with what the server saw. */
export interface DeviceProof {
  readonly device: Pick<DeviceRecord, "alg" | "publicKey">;
  /** The nonce of the server's `challenge`. */
  readonly nonce: string;
  /** The `Origin` the connection arrived with. */
  readonly origin: string;
  /** The `prove` frame's signature, in base64url. */
  readonly signature: string;
}

function publicKeyOf(device: DeviceProof["device"]): KeyObject {
  return createPublicKey({
    key: Buffer.from(device.publicKey, "base64url"),
    format: "der",
    type: "spki",
  });
}

function verifies(proof: DeviceProof): boolean {
  const key = publicKeyOf(proof.device);
  const text = Buffer.from(deviceProofText({ nonce: proof.nonce, origin: proof.origin }), "utf8");
  const signature = Buffer.from(proof.signature, "base64url");
  if (proof.device.alg === "ed25519") {
    return key.asymmetricKeyType === "ed25519" && verify(null, text, key, signature);
  }
  return (
    key.asymmetricKeyDetails?.namedCurve === "prime256v1" &&
    verify("sha256", text, { key, dsaEncoding: "ieee-p1363" }, signature)
  );
}

/**
 * Whether a device signed the challenge text with the key it paired. The stored public key is its
 * SPKI DER in base64url, as WebCrypto exports it. An Ed25519 key verifies raw; a P-256 key verifies
 * SHA-256 with the 64-byte signature WebCrypto writes. A key of another kind, or one that does not
 * parse, never verifies.
 */
export function isDeviceProofValid(proof: DeviceProof): boolean {
  try {
    return verifies(proof);
  } catch {
    return false;
  }
}
