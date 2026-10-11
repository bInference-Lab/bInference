import { describe, expect, it } from "vitest";
import { hpkeOpen, hpkeSeal, type HpkeSealed, type HpkeUse } from "./hpke-seal.js";

const backups: HpkeUse = { aead: "aes-256-gcm", info: "a backup" };
const exports: HpkeUse = { aead: "chacha20-poly1305", info: "" };
const secret = Uint8Array.from({ length: 32 }, (_, index) => index);

async function recipient() {
  const { subtle } = globalThis.crypto;
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
  const spki = await subtle.exportKey("spki", pair.publicKey);
  return { pair, publicKey: Buffer.from(spki).toString("base64") };
}

async function sealed(publicKey: string, use: HpkeUse): Promise<HpkeSealed> {
  const done = await hpkeSeal(publicKey, secret, use);
  if (done === undefined) {
    throw new Error("Expected sealed bytes.");
  }
  return done;
}

describe("hpke on dhkem p-256", () => {
  it.each([backups, exports])("opens what was sealed to the key with $aead", async (use) => {
    const { pair, publicKey } = await recipient();

    const box = await sealed(publicKey, use);

    expect(await hpkeOpen(pair, box, use)).toStrictEqual(secret);
  });

  it("seals with a fresh ephemeral key each time", async () => {
    const { publicKey } = await recipient();

    const first = await sealed(publicKey, backups);
    const second = await sealed(publicKey, backups);

    expect(first.encapsulatedKey).toHaveLength(65);
    expect(first.ciphertext).toHaveLength(secret.length + 16);
    expect(first.encapsulatedKey).not.toStrictEqual(second.encapsulatedKey);
    expect(first.ciphertext).not.toStrictEqual(second.ciphertext);
  });

  it("opens nothing for another key, another info, another suite or a changed byte", async () => {
    const { pair, publicKey } = await recipient();
    const other = await recipient();
    const box = await sealed(publicKey, backups);
    const flipped = Buffer.from(box.ciphertext);
    flipped.writeUInt8(flipped.readUInt8(0) ^ 1, 0);

    expect(await hpkeOpen(other.pair, box, backups)).toBeUndefined();
    expect(await hpkeOpen(pair, box, { ...backups, info: "another" })).toBeUndefined();
    expect(await hpkeOpen(pair, box, exports)).toBeUndefined();
    expect(await hpkeOpen(pair, { ...box, ciphertext: flipped }, backups)).toBeUndefined();
  });

  it("seals nothing to a key that is no p-256 public key", async () => {
    expect(await hpkeSeal("AAAA", secret, backups)).toBeUndefined();
  });
});
