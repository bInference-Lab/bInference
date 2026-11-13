import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { BinferenceError } from "@binference/core";
import { base64urlBytes } from "./base64url-bytes.js";

/**
 * The listing keys in force (decision 0434): the public halves of the keys the listing catalog
 * signs with, each made into a key once, by its id.
 */
export interface ListingKeys {
  /** The ids in force, in the order the composition root gave them. */
  readonly ids: readonly string[];
  /** The key an envelope's `key` names, or none when no key in force has that id. */
  keyOf(id: string): KeyObject | undefined;
}

const maxKeys = 4;
// An Ed25519 SubjectPublicKeyInfo is 44 bytes; a larger text is no Ed25519 key.
const maxSpkiBytes = 64;

/** A listing key's id: the first 16 bytes of the SHA-256 of its SPKI DER, in lowercase hex. */
export function listingKeyId(spkiDer: Uint8Array): string {
  return createHash("sha256").update(spkiDer).digest("hex").slice(0, 32);
}

function refused(message: string): BinferenceError {
  return new BinferenceError({ code: "plugin.listing_keys", message });
}

function keyFrom(spki: string): { readonly id: string; readonly key: KeyObject } {
  const der = base64urlBytes(spki, maxSpkiBytes);
  if (der === undefined) {
    throw refused("A listing key is not a public key's DER in base64url.");
  }
  try {
    const key = createPublicKey({ key: Buffer.from(der), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") {
      throw refused("A listing key is not an Ed25519 key.");
    }
    return { id: listingKeyId(der), key };
  } catch (error) {
    throw error instanceof BinferenceError ? error : refused("A listing key does not read.");
  }
}

/**
 * Makes the listing keys in force from 1 to 4 public keys, each its SubjectPublicKeyInfo DER in
 * base64url, as KMS's `GetPublicKey` answers it. A key that is not Ed25519, two keys with one id,
 * none or more than 4 refuse the composition with `plugin.listing_keys`: an envelope verifies only
 * under the key it names (decision 0434).
 */
export function createListingKeys(spkiTexts: readonly string[]): ListingKeys {
  if (spkiTexts.length === 0 || spkiTexts.length > maxKeys) {
    throw refused(`From 1 to ${String(maxKeys)} listing keys are in force.`);
  }
  const keys = new Map<string, KeyObject>();
  for (const spki of spkiTexts) {
    const { id, key } = keyFrom(spki);
    if (keys.has(id)) {
      throw refused("Two listing keys have one id.");
    }
    keys.set(id, key);
  }
  return { ids: [...keys.keys()], keyOf: (id) => keys.get(id) };
}
