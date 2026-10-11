import {
  createECDH,
  createHmac,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  randomBytes,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import { hpkeOpen, hpkeSeal } from "./hpke-seal.js";
import {
  deriveP256KeyPair,
  deriveSealingKey,
  sealingKeyInfo,
  sealingKeyMaterial,
} from "./sealing-key.js";

// P-256's group order, n.
const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

// HKDF-Extract and HKDF-Expand of RFC 5869 on HMAC-SHA256, written out for this test alone; a
// 32-byte output is one block. An empty salt is HMAC's key of zeros.
function extract(salt: Uint8Array, ikm: Uint8Array): Buffer {
  return createHmac("sha256", salt).update(ikm).digest();
}
function expandOne(prk: Uint8Array, info: Uint8Array): Buffer {
  return createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.of(1)]))
    .digest();
}

// RFC 9180, section 7.1.3: DeriveKeyPair for DHKEM(P-256, HKDF-SHA256), as the RFC writes it.
function referenceScalar(ikm: Uint8Array): bigint {
  const suite = Buffer.concat([Buffer.from("KEM"), Buffer.of(0x00, 0x10)]);
  const version = Buffer.from("HPKE-v1");
  const prk = extract(
    new Uint8Array(0),
    Buffer.concat([version, suite, Buffer.from("dkp_prk"), ikm]),
  );
  for (let counter = 0; counter < 256; counter += 1) {
    const info = Buffer.concat([
      Buffer.of(0x00, 0x20),
      version,
      suite,
      Buffer.from("candidate"),
      Buffer.of(counter),
    ]);
    const candidate = BigInt(`0x${hex(expandOne(prk, info))}`);
    if (candidate !== 0n && candidate < order) {
      return candidate;
    }
  }
  throw new Error("No candidate in 256 tries.");
}

function ownerKeyOf(scalarHex: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(scalarHex, "hex"));
  const point = ecdh.getPublicKey();
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: Buffer.from(scalarHex, "hex").toString("base64url"),
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
    },
  });
}

// The uncompressed public point of a private key, as RFC 9180's vectors write pkRm.
function pointOf(key: KeyObject): string {
  const { x, y } = createPublicKey(key).export({ format: "jwk" });
  return hex(
    Buffer.concat([
      Buffer.of(4),
      Buffer.from(x ?? "", "base64url"),
      Buffer.from(y ?? "", "base64url"),
    ]),
  );
}

// Opens what HPKE sealed with the given key, if anything was sealed.
async function openedWith(
  recipient: Parameters<typeof hpkeOpen>[0],
  sealed: Awaited<ReturnType<typeof hpkeSeal>>,
  use: Parameters<typeof hpkeOpen>[2],
): Promise<string | undefined> {
  const opened = sealed === undefined ? undefined : await hpkeOpen(recipient, sealed, use);
  return opened === undefined ? undefined : Buffer.from(opened).toString();
}

function scalarOfKey(key: KeyObject): string {
  const { d } = key.export({ format: "jwk" });
  return Buffer.from(d ?? "", "base64url").toString("hex");
}

// RFC 6979, appendix A.2.5: the P-256 private key of its worked examples, used here as an owner key.
const ownerScalar = "c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721";
// What that owner key derives, worked out apart from this code base (HMAC-SHA256 and P-256 point
// arithmetic written out by hand): the HKDF output, the sealing scalar and its public half.
const pinned = {
  material: "1eb95a0f99ae31d653ed73efd4c2dc3e89a92f523acc5e0ac5a1a1e34e8eb40b",
  scalar: "1105c3d5105c2e9bfad5683495d1c7eb81a58546f65a40bb2c360734f447a3d0",
  publicKey:
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEGqLFaqm0ujufcoQlZOMg5C8TleAS9CjytFWdBeBDXWvBzOrGrs+DN+z1OFgKcPkzegOblMIKxKFS5JjhfxrdPQ==",
};

describe("the sealing key derived from the owner key", () => {
  it("maps keying material to a key pair as RFC 9180's DHKEM(P-256) test vector says", () => {
    // RFC 9180, appendix A.3.1: the recipient's ikmR and the skRm and pkRm it derives.
    const ikm = Buffer.from(
      "668b37171f1072f3cf12ea8a236a45df23fc13b82af3609ad1e354f6ef817550",
      "hex",
    );
    const pair = deriveP256KeyPair(ikm);

    expect(scalarOfKey(pair.privateKey)).toBe(
      "f3ce7fdae57e1a310d87f1ebbde6f328be0a99cdbcadf4d6589cf29de4b8ffd2",
    );
    expect(pointOf(pair.privateKey)).toBe(
      "04fe8c19ce0905191ebc298a9245792531f26f0cece2460639e8bc39cb7f706a826a779b4cf969b8a0e539c7f62fb3d30ad6aa8f80e30f1d128aafd68a2ce72ea0",
    );
  });

  it("derives its keying material with HKDF-SHA256 and its own info, as RFC 5869 writes it", () => {
    const scalar = Buffer.from(ownerScalar, "hex");
    const prk = extract(new Uint8Array(0), scalar);

    expect(hex(sealingKeyMaterial(scalar))).toBe(hex(expandOne(prk, Buffer.from(sealingKeyInfo))));
    expect(hex(sealingKeyMaterial(scalar))).toBe(pinned.material);
  });

  it("derives the pinned key from a known owner key, the same each time", async () => {
    const owner = ownerKeyOf(ownerScalar);

    const first = deriveSealingKey(owner);
    const again = deriveSealingKey(owner);

    const material = sealingKeyMaterial(Buffer.from(ownerScalar, "hex"));
    const scalar = referenceScalar(material);
    const derived = scalarOfKey(deriveP256KeyPair(material).privateKey);
    expect(BigInt(`0x${derived}`)).toBe(scalar);
    expect(first.publicKey).toBe(again.publicKey);
    expect(first.publicKey).toBe(pinned.publicKey);
    expect(derived).toBe(pinned.scalar);
  });

  it("derives the reference implementation's key from random keying material", () => {
    for (let run = 0; run < 64; run += 1) {
      const ikm = randomBytes(32);
      const derived = scalarOfKey(deriveP256KeyPair(ikm).privateKey);
      expect(BigInt(`0x${derived}`)).toBe(referenceScalar(ikm));
    }
  });

  it("is not the owner key, and opens what was sealed to its public half", async () => {
    const owner = ownerKeyOf(ownerScalar);
    const sealing = deriveSealingKey(owner);
    const use = { aead: "aes-256-gcm", info: "binference-backup v3" } as const;
    const ownerPublic = createPublicKey(owner).export({ type: "spki", format: "der" });

    const sealed = await hpkeSeal(sealing.publicKey, Buffer.from("data key"), use);

    const toOwner = await hpkeSeal(ownerPublic.toString("base64"), Buffer.from("x"), use);

    expect(sealing.publicKey).not.toBe(ownerPublic.toString("base64"));
    expect(await openedWith(sealing.recipient, toOwner, use)).toBeUndefined();
    expect(await openedWith(sealing.recipient, sealed, use)).toBe("data key");
  });
});
