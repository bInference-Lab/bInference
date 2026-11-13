import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createListingSigner } from "./fake-listing-signer.js";
import { createListingKeys, listingKeyId } from "./listing-keys.js";

const p256 = (): string =>
  generateKeyPairSync("ec", { namedCurve: "P-256" })
    .publicKey.export({ format: "der", type: "spki" })
    .toString("base64url");

describe("the listing keys in force", () => {
  it("names each key by the first 16 bytes of the SHA-256 of its public half", () => {
    const signer = createListingSigner();
    const der = Buffer.from(signer.spki, "base64url");
    const keys = createListingKeys([signer.spki]);

    expect(listingKeyId(der)).toBe(createHash("sha256").update(der).digest("hex").slice(0, 32));
    expect(keys.ids).toStrictEqual([signer.id]);
    expect(keys.keyOf(signer.id)?.asymmetricKeyType).toBe("ed25519");
    expect(keys.keyOf(createListingSigner().id)).toBeUndefined();
  });

  it("holds up to four keys, each once", () => {
    const signers = [1, 2, 3, 4].map(() => createListingSigner());
    const keys = createListingKeys(signers.map(({ spki }) => spki));
    expect(keys.ids).toStrictEqual(signers.map(({ id }) => id));
  });

  it.each([
    ["no key", () => []],
    ["five keys", () => [1, 2, 3, 4, 5].map(() => createListingSigner().spki)],
    ["a key twice", () => [createListingSigner().spki].flatMap((spki) => [spki, spki])],
    ["a P-256 key", () => [p256()]],
    ["a text that is no key", () => ["AAAA"]],
    ["a key in base64 with padding", () => [`${createListingSigner().spki}=`]],
  ])("refuses the composition with %s", (_what, texts) => {
    expect(() => createListingKeys(texts())).toThrow(
      expect.objectContaining({ code: "plugin.listing_keys" }),
    );
  });
});
