import { createPublicKey, type KeyObject } from "node:crypto";
import type { HpkeRecipientKey } from "../hpke/hpke-seal.js";

const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;

/**
 * The owner key as an HPKE recipient: its P-256 private half as a WebCrypto ECDH key that cannot
 * be exported, with its public half, which HPKE's key schedule reads. The owner key signs Privy
 * requests with ECDSA too; keys spec, section 7.2 seals each backup's data key to it with DHKEM.
 */
export function ownerKeyRecipient(privateKey: KeyObject): HpkeRecipientKey {
  return {
    privateKey: privateKey.toCryptoKey(ecdh, false, ["deriveBits"]),
    publicKey: createPublicKey(privateKey).toCryptoKey(ecdh, true, []),
  };
}
