import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { createSecret, secretMark } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  createP256KeyPair,
  type P256KeyPair,
  p256KeyPairFromScalar,
} from "../keys/p256-key-pair.js";
import { formatAgentKey, parseAgentKey } from "./agent-key-text.js";

const generatorX = "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296";
const generatorY = "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5";
const testScalar = `${"00".repeat(31)}01`;

// The test key with the scalar 1, laid out by hand: PKCS #8 (RFC 5208) around an RFC 5915
// ECPrivateKey with its public point. The platform's pinned agent-key file seals this text.
const knownText = Buffer.from(
  "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420" +
    `${testScalar}a14403420004${generatorX}${generatorY}`,
  "hex",
).toString("base64");
const knownPublicKey = Buffer.from(
  `3059301306072a8648ce3d020106082a8648ce3d03010703420004${generatorX}${generatorY}`,
  "hex",
).toString("base64");

const publicKeyOf = (text: string): string => {
  const parsed = parseAgentKey(createSecret(text));
  return parsed.ok ? parsed.value.publicKey : parsed.error;
};

const der = (key: KeyObject): string =>
  key.export({ type: "pkcs8", format: "der" }).toString("base64");

function testPair(): P256KeyPair {
  const pair = p256KeyPairFromScalar(Buffer.from(testScalar, "hex"));
  if (!pair.ok) {
    throw new Error("the test scalar makes no key");
  }
  return pair.value;
}

describe("agent key text", () => {
  it("writes the known text of the test key and reads it back", () => {
    expect(formatAgentKey(testPair()).reveal()).toBe(knownText);
    expect(publicKeyOf(knownText)).toBe(knownPublicKey);
  });

  it("writes one line of base64 that reads back to the same key", () => {
    const pair = createP256KeyPair();
    const text = formatAgentKey(pair);

    expect(text.reveal()).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(publicKeyOf(text.reveal())).toBe(pair.publicKey);
    expect([String(text), JSON.stringify(text)]).toStrictEqual([secretMark, `"${secretMark}"`]);
  });

  it("reads the text with a file's last newline or spaces around it", () => {
    expect(
      [`${knownText}\n`, `${knownText}\r\n`, `  ${knownText} `].map(publicKeyOf),
    ).toStrictEqual([knownPublicKey, knownPublicKey, knownPublicKey]);
  });

  it.each([
    ["nothing", ""],
    ["text that is not base64", "agent key!"],
    ["base64 that is no key", Buffer.from("not a key at all").toString("base64")],
    ["the key split over two lines", `${knownText.slice(0, 64)}\n${knownText.slice(64)}`],
    ["the key in base64url", Buffer.from(knownText, "base64").toString("base64url")],
    ["the key cut short", knownText.slice(0, 120)],
    ["a secp256k1 key", der(generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey)],
    ["an Ed25519 key", der(generateKeyPairSync("ed25519").privateKey)],
    ["a public key", knownPublicKey],
  ])("refuses %s as malformed and echoes none of it", (_case, text) => {
    expect(parseAgentKey(createSecret(text))).toStrictEqual({ ok: false, error: "malformed" });
  });
});
