import { base64url } from "./base64url";

/** The signature scheme of a device key: Ed25519, or ECDSA P-256 where Ed25519 is missing. */
export type DeviceAlg = "ed25519" | "p256";

/** A new device key pair: the private half never leaves WebCrypto. */
export interface NewDeviceKey {
  readonly alg: DeviceAlg;
  readonly privateKey: CryptoKey;
  /** The public half as SPKI DER in base64url, as `POST /pair` takes it. */
  readonly publicKey: string;
}

const algorithms: Readonly<Record<DeviceAlg, EcKeyGenParams | Algorithm>> = {
  ed25519: { name: "Ed25519" },
  p256: { name: "ECDSA", namedCurve: "P-256" },
};

async function generate(subtle: SubtleCrypto, alg: DeviceAlg): Promise<NewDeviceKey> {
  const pair = await subtle.generateKey(algorithms[alg], false, ["sign", "verify"]);
  if (!("privateKey" in pair)) {
    throw new TypeError("WebCrypto made a single key where a key pair was asked for.");
  }
  const spki = await subtle.exportKey("spki", pair.publicKey);
  return { alg, privateKey: pair.privateKey, publicKey: base64url(spki) };
}

/**
 * Makes the browser's device key with WebCrypto, marked non-extractable: Ed25519, or ECDSA P-256
 * where the browser has no Ed25519 (protocol spec, section 4.2). Only the public half can be read.
 */
export async function createDeviceKey(subtle: SubtleCrypto): Promise<NewDeviceKey> {
  try {
    return await generate(subtle, "ed25519");
  } catch {
    return generate(subtle, "p256");
  }
}

/** Signs text with a device key, as its scheme asks: Ed25519, or ECDSA with SHA-256. */
export async function signWith(
  subtle: SubtleCrypto,
  key: { readonly alg: DeviceAlg; readonly privateKey: CryptoKey },
  text: string,
): Promise<string> {
  const data = new TextEncoder().encode(text);
  const algorithm =
    key.alg === "ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
  return base64url(await subtle.sign(algorithm, key.privateKey, data));
}
