import { Buffer } from "node:buffer";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { idSchema } from "@binference/core";
import { deviceProofText } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { isDeviceProofValid } from "./device-proof.js";

const nonce = "n".repeat(43);
const origin = "http://127.0.0.1:7456";
const connection = "con_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const id = idSchema("dev").parse("dev_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const otherId = idSchema("dev").parse("dev_0190f1c2-3a4b-7c5d-8e6f-000000000002");

function spki(key: KeyObject): string {
  return key.export({ format: "der", type: "spki" }).toString("base64url");
}

const ed25519 = generateKeyPairSync("ed25519");
const p256 = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
const text = Buffer.from(deviceProofText({ connection, device: id, nonce, origin }));
const edSignature = sign(null, text, ed25519.privateKey).toString("base64url");
const ecSignature = sign("sha256", text, {
  key: p256.privateKey,
  dsaEncoding: "ieee-p1363",
}).toString("base64url");
const edDevice = { id, alg: "ed25519", publicKey: spki(ed25519.publicKey) } as const;
const ecDevice = { id, alg: "p256", publicKey: spki(p256.publicKey) } as const;
const seen = { connection, nonce, origin } as const;

describe("isDeviceProofValid", () => {
  it("accepts an Ed25519 signature over the connection, device, nonce and origin", () => {
    expect(isDeviceProofValid({ device: edDevice, ...seen, signature: edSignature })).toBe(true);
  });

  it("accepts a P-256 signature as WebCrypto writes it", () => {
    expect(isDeviceProofValid({ device: ecDevice, ...seen, signature: ecSignature })).toBe(true);
  });

  it.each([
    [
      "another origin",
      { device: edDevice, ...seen, origin: "http://evil.example", signature: edSignature },
    ],
    ["another nonce", { device: edDevice, ...seen, nonce: "m".repeat(43), signature: edSignature }],
    [
      "another connection",
      {
        device: edDevice,
        ...seen,
        connection: `${connection.slice(0, -1)}2`,
        signature: edSignature,
      },
    ],
    [
      "another device's record with the same key",
      { device: { ...edDevice, id: otherId }, ...seen, signature: edSignature },
    ],
    [
      "a key of another kind than paired",
      { device: { ...ecDevice, publicKey: edDevice.publicKey }, ...seen, signature: edSignature },
    ],
    [
      "a P-256 pairing holding another curve",
      { device: { ...ecDevice, publicKey: spki(p384.publicKey) }, ...seen, signature: ecSignature },
    ],
    [
      "a key that does not parse",
      { device: { ...edDevice, publicKey: "AAAA" }, ...seen, signature: edSignature },
    ],
  ] as const)("refuses a proof with %s", (_name, proof) => {
    expect(isDeviceProofValid(proof)).toBe(false);
  });
});
