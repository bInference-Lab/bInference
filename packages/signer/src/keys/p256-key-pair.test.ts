import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { inspect } from "node:util";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createP256KeyPair,
  type P256KeyPair,
  p256KeyPairFromScalar,
  p256KeyPairOf,
  p256ScalarOf,
} from "./p256-key-pair.js";

// SEC 2, section 2.4.2: the curve's prime, its order and its generator.
const prime = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const generatorX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const generatorY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;
// DER SubjectPublicKeyInfo up to the point: id-ecPublicKey, prime256v1, a 66-byte bit string.
const spkiHeader = "3059301306072a8648ce3d020106082a8648ce3d030107034200";

const hex32 = (value: bigint): string => value.toString(16).padStart(64, "0");
const scalarOf = (value: bigint): Uint8Array => Buffer.from(hex32(value), "hex");
const spkiOf = (x: bigint, y: bigint): string =>
  Buffer.from(`${spkiHeader}04${hex32(x)}${hex32(y)}`, "hex").toString("base64");

function pairFrom(value: bigint): P256KeyPair {
  const pair = p256KeyPairFromScalar(scalarOf(value));
  if (!pair.ok) {
    throw new Error(`no pair for the test scalar ${String(value)}`);
  }
  return pair.value;
}

// Every text a leak of the private half could show up as.
function privateForms(pair: P256KeyPair): readonly string[] {
  const scalar = p256ScalarOf(pair);
  const pkcs8 = pair.privateKey.export({ type: "pkcs8", format: "der" });
  return [scalar.toString("hex"), scalar.toString("base64"), pkcs8.toString("base64")];
}

describe("key pairs on P-256", () => {
  it("makes a different pair each time", () => {
    const keys = Array.from({ length: 32 }, () => createP256KeyPair().publicKey);
    expect(new Set(keys).size).toBe(32);
  });

  it("gives the public half as DER SubjectPublicKeyInfo in base64, on P-256", () => {
    const pair = createP256KeyPair();
    const der = Buffer.from(pair.publicKey, "base64");
    const key = createPublicKey({ key: der, format: "der", type: "spki" });

    expect(der.toString("hex").startsWith(spkiHeader)).toBe(true);
    expect(der).toHaveLength(91);
    expect(key.asymmetricKeyDetails).toStrictEqual({ namedCurve: "prime256v1" });
  });

  it("signs with the private half what the public half verifies", () => {
    const pair = createP256KeyPair();
    const message = Buffer.from("POST /v1/wallets/rpc");
    const signature = sign("sha256", message, pair.privateKey);
    const publicKey = createPublicKey({
      key: Buffer.from(pair.publicKey, "base64"),
      format: "der",
      type: "spki",
    });

    expect(verify("sha256", message, publicKey, signature)).toBe(true);
    expect(verify("sha256", Buffer.from("other"), publicKey, signature)).toBe(false);
  });

  it("rebuilds the curve's generator from the scalar 1, and its negation from the order less 1", () => {
    expect(pairFrom(1n).publicKey).toBe(spkiOf(generatorX, generatorY));
    expect(pairFrom(order - 1n).publicKey).toBe(spkiOf(generatorX, prime - generatorY));
  });

  it("gives back the scalar a pair was made from", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: order - 1n }), (value) => {
        expect(p256ScalarOf(pairFrom(value)).toString("hex")).toBe(hex32(value));
      }),
      { numRuns: 50 },
    );
  });

  it.each([
    ["zero", scalarOf(0n)],
    ["the order", scalarOf(order)],
    ["the largest 32-byte number", scalarOf(2n ** 256n - 1n)],
    ["31 bytes", new Uint8Array(31).fill(1)],
    ["33 bytes", new Uint8Array(33).fill(1)],
  ])("refuses %s as a scalar", (_case, scalar) => {
    expect(p256KeyPairFromScalar(scalar)).toStrictEqual({ ok: false, error: "invalid_scalar" });
  });

  it.each([
    ["a public key", generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey],
    ["a secp256k1 key", generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey],
    ["an Ed25519 key", generateKeyPairSync("ed25519").privateKey],
  ])("refuses %s as a P-256 private key", (_case, key) => {
    expect(p256KeyPairOf(key)).toStrictEqual({ ok: false, error: "not_p256" });
  });

  it("shows no key material when a pair is printed, inspected or serialized", () => {
    const pair = createP256KeyPair();
    const shown = [inspect(pair, { depth: 10, showHidden: true }), JSON.stringify(pair)].join("\n");

    expect(privateForms(pair).filter((form) => shown.includes(form))).toStrictEqual([]);
    expect(shown).toContain(pair.publicKey);
  });
});
