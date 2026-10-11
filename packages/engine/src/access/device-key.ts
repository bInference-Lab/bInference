import { Buffer } from "node:buffer";
import { createPublicKey, type KeyObject } from "node:crypto";
import type { DeviceRecord } from "./device-record.js";

/** A console device's public key: its scheme and its SPKI DER in base64url, as WebCrypto exports it. */
export type DeviceKey = Pick<DeviceRecord, "alg" | "publicKey">;

function parsed(key: DeviceKey): KeyObject {
  const der = Buffer.from(key.publicKey, "base64url");
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

/**
 * The key object of a device's public key, or `undefined` when the text is not an SPKI key of the
 * scheme it names: an Ed25519 key for `ed25519`, a P-256 key for `p256`. Pairing refuses such a
 * key, and a stored one never verifies a proof.
 */
export function deviceKeyObject(key: DeviceKey): KeyObject | undefined {
  try {
    const object = parsed(key);
    const isOfScheme =
      key.alg === "ed25519"
        ? object.asymmetricKeyType === "ed25519"
        : object.asymmetricKeyDetails?.namedCurve === "prime256v1";
    return isOfScheme ? object : undefined;
  } catch {
    return undefined;
  }
}
