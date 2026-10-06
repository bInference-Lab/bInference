import { Buffer } from "node:buffer";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { deviceProofText } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { isDeviceProofValid } from "./device-proof.js";

const nonce = "n".repeat(43);
const origin = "http://127.0.0.1:7456";

function spki(key: KeyObject): string {
  return key.export({ format: "der", type: "spki" }).toString("base64url");
}

const ed25519 = generateKeyPairSync("ed25519");
const p256 = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
const text = Buffer.from(deviceProofText({ nonce, origin }));
const edSignature = sign(null, text, ed25519.privateKey).toString("base64url");
const ecSignature = sign("sha256", text, {
  key: p256.privateKey,
  dsaEncoding: "ieee-p1363",
}).toString("base64url");
const edDevice = { alg: "ed25519", publicKey: spki(ed25519.publicKey) } as const;
const ecDevice = { alg: "p256", publicKey: spki(p256.publicKey) } as const;

describe("isDeviceProofValid", () => {
  it("accepts an Ed25519 signature over the nonce and origin", () => {
    expect(isDeviceProofValid({ device: edDevice, nonce, origin, signature: edSignature })).toBe(
      true,
    );
  });

  it("accepts a P-256 signature as WebCrypto writes it", () => {
    expect(isDeviceProofValid({ device: ecDevice, nonce, origin, signature: ecSignature })).toBe(
      true,
    );
  });

  it.each([
    [
      "another origin",
      { device: edDevice, nonce, origin: "http://evil.example", signature: edSignature },
    ],
    ["another nonce", { device: edDevice, nonce: "m".repeat(43), origin, signature: edSignature }],
    [
      "a key of another kind than paired",
      {
        device: { ...ecDevice, publicKey: edDevice.publicKey },
        nonce,
        origin,
        signature: edSignature,
      },
    ],
    [
      "a P-256 pairing holding another curve",
      {
        device: { ...ecDevice, publicKey: spki(p384.publicKey) },
        nonce,
        origin,
        signature: ecSignature,
      },
    ],
    [
      "a key that does not parse",
      { device: { ...edDevice, publicKey: "AAAA" }, nonce, origin, signature: edSignature },
    ],
  ] as const)("refuses a proof with %s", (_name, proof) => {
    expect(isDeviceProofValid(proof)).toBe(false);
  });
});
