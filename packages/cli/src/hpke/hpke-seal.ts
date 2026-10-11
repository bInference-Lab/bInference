import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";

/** What one seal or open names: the suite's AEAD and the application's `info` text. */
export interface HpkeUse {
  /**
   * The AEAD of the suite on DHKEM P-256 and HKDF-SHA256 (RFC 9180): ChaCha20-Poly1305 for
   * Privy's wallet export (decision 0131), AES-256-GCM for a backup's data key (keys spec,
   * section 7.2).
   */
  readonly aead: "chacha20-poly1305" | "aes-256-gcm";
  /** HPKE's `info`, bound into the key schedule; empty when the other side sends none. */
  readonly info: string;
}

/** An ECDH P-256 private key, or a pair that holds one, as WebCrypto makes or imports it. */
export type HpkeRecipientKey =
  | CryptoKey
  | { readonly privateKey: CryptoKey; readonly publicKey: CryptoKey };

/** Bytes sealed to a P-256 key with HPKE in base mode. */
export interface HpkeSealed {
  /** The sender's encapsulated key: an uncompressed P-256 point of 65 bytes. */
  readonly encapsulatedKey: Uint8Array;
  readonly ciphertext: Uint8Array;
}

const suites: Readonly<Record<HpkeUse["aead"], CipherSuite>> = {
  "chacha20-poly1305": new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Chacha20Poly1305(),
  }),
  "aes-256-gcm": new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  }),
};

const encoder = new TextEncoder();

/**
 * Seals bytes to a P-256 public key given as DER SubjectPublicKeyInfo in base64, with a fresh
 * ephemeral key from WebCrypto's CSPRNG. Answers `undefined` for a key that is no such key.
 */
export async function hpkeSeal(
  recipientPublicKey: string,
  plaintext: Uint8Array,
  use: HpkeUse,
): Promise<HpkeSealed | undefined> {
  const recipient = await importRecipient(recipientPublicKey);
  if (recipient === undefined) {
    return undefined;
  }
  const sealed = await suites[use.aead].seal(
    { recipientPublicKey: recipient, info: encoder.encode(use.info) },
    plaintext,
  );
  return { encapsulatedKey: new Uint8Array(sealed.enc), ciphertext: new Uint8Array(sealed.ct) };
}

/**
 * Opens bytes sealed to the P-256 key whose private half is given as an ECDH key, or a pair that
 * holds one. Answers `undefined` when they were sealed to another key, under another `info`, or
 * changed: the AEAD tag cannot tell these apart. The caller zeroes the bytes once it is done.
 */
export async function hpkeOpen(
  recipientKey: HpkeRecipientKey,
  sealed: HpkeSealed,
  use: HpkeUse,
): Promise<Uint8Array | undefined> {
  try {
    const opened = await suites[use.aead].open(
      { recipientKey, enc: sealed.encapsulatedKey, info: encoder.encode(use.info) },
      sealed.ciphertext,
    );
    return new Uint8Array(opened);
  } catch {
    return undefined;
  }
}

async function importRecipient(publicKey: string): Promise<CryptoKey | undefined> {
  try {
    return await globalThis.crypto.subtle.importKey(
      "spki",
      Buffer.from(publicKey, "base64"),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );
  } catch {
    return undefined;
  }
}
