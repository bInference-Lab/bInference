import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { type JsonValue, stableJson } from "@binference/core";
import { type ListingKind, listingStatement } from "./listing-envelope.js";
import { listingKeyId } from "./listing-keys.js";

/**
 * A listing key for tests, made with `node:crypto` as the test runs, so no private key is ever in
 * the repository: its public half as the composition root takes it, its id, and envelopes it signs.
 */
export interface ListingSigner {
  /** The public half's SubjectPublicKeyInfo DER, in base64url. */
  readonly spki: string;
  readonly id: string;
  /** The envelope of a payload written in its canonical form, as the catalog writes one. */
  sign(kind: ListingKind, payload: JsonValue): string;
  /**
   * The envelope of these bytes as they are, under `keyId` when given, for payloads and key ids no
   * catalog writes.
   */
  signBytes(kind: ListingKind, bytes: Uint8Array, keyId?: string): string;
}

function envelope(parts: {
  readonly privateKey: KeyObject;
  readonly kind: ListingKind;
  readonly bytes: Uint8Array;
  readonly keyId: string;
}): string {
  const statement = listingStatement(parts.kind, parts.keyId, parts.bytes);
  const signature = sign(null, statement, parts.privateKey);
  return JSON.stringify({
    key: parts.keyId,
    payload: Buffer.from(parts.bytes).toString("base64url"),
    signature: signature.toString("base64url"),
  });
}

/** Makes a new Ed25519 listing key for one test. */
export function createListingSigner(): ListingSigner {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const id = listingKeyId(der);
  const signBytes = (kind: ListingKind, bytes: Uint8Array, keyId: string = id): string =>
    envelope({ privateKey, kind, bytes, keyId });
  return {
    spki: der.toString("base64url"),
    id,
    sign: (kind, payload) => signBytes(kind, new TextEncoder().encode(stableJson(payload))),
    signBytes,
  };
}
