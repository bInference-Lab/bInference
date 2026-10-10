import type { Secret } from "@binference/core";

/** An export of one wallet's private key, sealed to a recipient key, with the owner key. */
export interface ExportRequest {
  /** The wallet as custody names it: the wallet record's `custodyWalletId`. */
  readonly wallet: string;
  /** The owner key code as the owner typed it; custody uses it for this request only. */
  readonly ownerKey: Secret;
  /** The HPKE recipient key: a P-256 public key as DER SubjectPublicKeyInfo in base64. */
  readonly recipientPublicKey: string;
}

/**
 * A wallet's private key as custody sealed it with HPKE to the recipient key: only the recipient
 * key's private half opens it. Both in base64. The engine passes it on and keeps it nowhere.
 */
export interface SealedKey {
  readonly ciphertext: string;
  readonly encapsulatedKey: string;
}

/**
 * Why custody exported no key: the code is not the key that owns the wallet, custody holds no
 * such wallet, or the recipient key is no key it can seal to.
 */
export type ExportRefusal = "bad_owner_key" | "not_found" | "bad_recipient_key";
