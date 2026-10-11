import { Buffer } from "node:buffer";
import { verify } from "node:crypto";
import type { DeviceRecord } from "@binference/engine";
import { deviceKeyObject } from "@binference/engine/access";
import { deviceProofText } from "@binference/protocol";

/** A console device's answer to a challenge, with what the server saw. */
export interface DeviceProof {
  readonly device: Pick<DeviceRecord, "id" | "alg" | "publicKey">;
  /** The connection the `challenge` named. */
  readonly connection: string;
  /** The nonce of the server's `challenge`. */
  readonly nonce: string;
  /** The `Origin` the connection arrived with. */
  readonly origin: string;
  /** The `prove` frame's signature, in base64url. */
  readonly signature: string;
}

function verifies(proof: DeviceProof): boolean {
  const key = deviceKeyObject(proof.device);
  if (key === undefined) {
    return false;
  }
  const { connection, nonce, origin } = proof;
  const signed = deviceProofText({ connection, device: proof.device.id, nonce, origin });
  const text = Buffer.from(signed, "utf8");
  const signature = Buffer.from(proof.signature, "base64url");
  return proof.device.alg === "ed25519"
    ? verify(null, text, key, signature)
    : verify("sha256", text, { key, dsaEncoding: "ieee-p1363" }, signature);
}

/**
 * Whether a device signed the challenge text, for this connection, this device and the origin the
 * connection came from, with the key it paired. The stored public key is its
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
