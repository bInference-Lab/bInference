import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { privateKeyToAddress } from "viem/accounts";
import type { SealedWalletKey } from "../privy/wallet-export.js";

/** A test's HPKE recipient key: its public half to send, and what opens a key sealed to it. */
export interface TestRecipient {
  /** The P-256 public key as DER SubjectPublicKeyInfo in base64, as Privy's export takes it. */
  readonly publicKey: string;
  /** The text sealed to this key. */
  open(sealed: SealedWalletKey): Promise<string>;
}

const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

/**
 * Makes a fresh HPKE recipient on Privy's export suite (DHKEM P-256, HKDF-SHA256,
 * ChaCha20-Poly1305), as Privy's export docs do: an ECDH P-256 key pair from WebCrypto.
 */
export async function createTestRecipient(): Promise<TestRecipient> {
  const { subtle } = globalThis.crypto;
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const spki = await subtle.exportKey("spki", pair.publicKey);
  return {
    publicKey: Buffer.from(spki).toString("base64"),
    open: async ({ ciphertext, encapsulatedKey }) => {
      const recipient = await suite.createRecipientContext({
        recipientKey: pair.privateKey,
        enc: Buffer.from(encapsulatedKey, "base64"),
      });
      const opened = await recipient.open(Buffer.from(ciphertext, "base64"));
      return new TextDecoder().decode(opened);
    },
  };
}

function isHexKey(text: string): text is `0x${string}` {
  return /^0x[0-9a-f]{64}$/.test(text);
}

/** The Ethereum address of a private key in hex, to tell which wallet an export opened to. */
export function addressOfKey(privateKey: string): string | undefined {
  return isHexKey(privateKey) ? privateKeyToAddress(privateKey) : undefined;
}
