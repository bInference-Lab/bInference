import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";

/** A wallet's private key as custody sealed it, both parts in base64. */
export interface SealedKey {
  readonly ciphertext: string;
  readonly encapsulatedKey: string;
}

/**
 * An HPKE recipient key made for one export: its public half, which goes to the engine, and what
 * opens a key sealed to it. Its private half never leaves this process and cannot be read out.
 */
export interface KeyRecipient {
  /** A P-256 public key as DER SubjectPublicKeyInfo in base64, as Privy's export takes it. */
  readonly publicKey: string;
  /** The bytes sealed to this key; the caller zeroes them once they are shown. Rejects otherwise. */
  open(sealed: SealedKey): Promise<Uint8Array>;
}

// Privy's export suite (its export docs): DHKEM P-256 with HKDF-SHA256, HKDF-SHA256,
// ChaCha20-Poly1305, base mode.
const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

/**
 * Makes a fresh HPKE recipient key for one export (decision 0131), on Privy's export suite with
 * `@hpke/core`, as Privy's export docs and its Node SDK do: an ECDH P-256 key pair from WebCrypto.
 */
export async function createKeyRecipient(): Promise<KeyRecipient> {
  const { subtle } = globalThis.crypto;
  // The private half cannot be exported: it opens one sealed key in this process and is dropped.
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
  const spki = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
  return {
    publicKey: Buffer.from(spki).toString("base64"),
    open: async ({ ciphertext, encapsulatedKey }) => {
      const recipient = await suite.createRecipientContext({
        recipientKey: pair,
        enc: Buffer.from(encapsulatedKey, "base64"),
      });
      return new Uint8Array(await recipient.open(Buffer.from(ciphertext, "base64")));
    },
  };
}

/**
 * Seals text to a recipient key as custody does, for tests and stand-ins of custody; a key that
 * is no P-256 key in DER SubjectPublicKeyInfo seals nothing.
 */
export async function sealTo(
  recipientPublicKey: string,
  text: string,
): Promise<SealedKey | undefined> {
  try {
    const recipient = await globalThis.crypto.subtle.importKey(
      "spki",
      Buffer.from(recipientPublicKey, "base64"),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );
    const sender = await suite.createSenderContext({ recipientPublicKey: recipient });
    const sealed = await sender.seal(new TextEncoder().encode(text));
    return {
      ciphertext: Buffer.from(sealed).toString("base64"),
      encapsulatedKey: Buffer.from(sender.enc).toString("base64"),
    };
  } catch {
    return undefined;
  }
}
