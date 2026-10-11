import { deviceProofText } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createDeviceKey, signWith } from "./device-key";

const { subtle } = globalThis.crypto;

function bytesOf(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  bytes.forEach((_byte, index) => {
    bytes[index] = binary.charCodeAt(index);
  });
  return bytes;
}

async function verifies(
  key: { readonly alg: string; readonly publicKey: string },
  signed: string,
  text: string,
) {
  const ed = key.alg === "ed25519";
  const algorithm = ed ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
  const publicKey = await subtle.importKey("spki", bytesOf(key.publicKey), algorithm, true, [
    "verify",
  ]);
  const check = ed ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
  return subtle.verify(check, publicKey, bytesOf(signed), new TextEncoder().encode(text));
}

// A WebCrypto without Ed25519, as some browsers still are.
const withoutEd25519: SubtleCrypto = Object.assign(Object.create(subtle) as SubtleCrypto, {
  generateKey: async (...args: [EcKeyGenParams, false, KeyUsage[]]) =>
    args[0].name === "Ed25519"
      ? Promise.reject(new DOMException("Not supported", "NotSupportedError"))
      : subtle.generateKey(...args),
  exportKey: subtle.exportKey.bind(subtle),
  sign: subtle.sign.bind(subtle),
});

const signedFor = {
  connection: "con_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  device: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  nonce: "bm9uY2U",
};

describe("device keys", () => {
  it("makes a non-extractable Ed25519 key whose signature the public half verifies", async () => {
    const key = await createDeviceKey(subtle);
    expect(key.alg).toBe("ed25519");
    expect(key.privateKey.extractable).toBe(false);
    await expect(subtle.exportKey("pkcs8", key.privateKey)).rejects.toMatchObject({
      name: "InvalidAccessError",
    });
    const text = deviceProofText({ ...signedFor, origin: "http://127.0.0.1:7456" });
    const signed = await signWith(subtle, key, text);
    await expect(verifies(key, signed, text)).resolves.toBe(true);
    await expect(verifies(key, signed, `${text}x`)).resolves.toBe(false);
  });

  it("falls back to ECDSA P-256 where the browser has no Ed25519", async () => {
    const key = await createDeviceKey(withoutEd25519);
    expect(key.alg).toBe("p256");
    expect(key.privateKey.extractable).toBe(false);
    const text = deviceProofText({ ...signedFor, origin: "http://localhost:7456" });
    const signed = await signWith(subtle, key, text);
    expect(bytesOf(signed)).toHaveLength(64);
    await expect(verifies(key, signed, text)).resolves.toBe(true);
  });
});
