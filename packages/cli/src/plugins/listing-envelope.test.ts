import { createHash } from "node:crypto";
import { stableJson } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createListingSigner } from "./fake-listing-signer.js";
import { listingStatement, openEnvelope, payloadLimits } from "./listing-envelope.js";
import { asPayload, listingFixture, revocationListFixture } from "./listing-fixtures.js";
import { createListingKeys } from "./listing-keys.js";

const signer = createListingSigner();
const keys = createListingKeys([signer.spki]);
const listing = asPayload(listingFixture());
const asListing = { kind: "pluginListing", keys } as const;
const asList = { kind: "pluginRevocations", keys } as const;
const encoder = new TextEncoder();

interface Fields {
  readonly key: string;
  readonly payload: string;
  readonly signature: string;
}

// An envelope's fields, for tests that change one after signing.
function fieldsOf(text: string): Fields {
  return JSON.parse(text) as Fields;
}

const isUnverified = (text: string): boolean => {
  const read = openEnvelope(text, asListing);
  return !read.ok && read.error === "unverified";
};

describe("opening a listing's envelope", () => {
  it("answers the payload, its SHA-256 and the key that signed it", () => {
    const text = signer.sign("pluginListing", listing);
    const bytes = encoder.encode(stableJson(listing));

    expect(openEnvelope(text, asListing)).toStrictEqual({
      ok: true,
      value: {
        payload: listing,
        digest: createHash("sha256").update(bytes).digest("hex"),
        key: signer.id,
      },
    });
  });

  it("signs a statement of the domain, the kind, the key's id and the payload's SHA-256", () => {
    const bytes = encoder.encode(stableJson(listing));
    const digest = createHash("sha256").update(bytes).digest();
    const expected = Buffer.concat([
      Buffer.from(`binference-listing-v1\0pluginListing\0${signer.id}\0`, "ascii"),
      digest,
    ]);
    const statement = listingStatement("pluginListing", signer.id, bytes);

    expect(Buffer.from(statement)).toStrictEqual(expected);
    expect(statement.length).toBe(101);
    expect(listingStatement("pluginRevocations", signer.id, bytes).length).toBe(105);
  });

  it("refuses a listing signed by another key, under its own id or under one in force", () => {
    const other = createListingSigner();
    const bytes = encoder.encode(stableJson(listing));

    expect(isUnverified(other.sign("pluginListing", listing))).toBe(true);
    expect(isUnverified(other.signBytes("pluginListing", bytes, signer.id))).toBe(true);
  });

  it("checks only the key an envelope names, even when the key that signed it is in force", () => {
    const other = createListingSigner();
    const both = createListingKeys([signer.spki, other.spki]);
    const bytes = encoder.encode(stableJson(listing));
    const misnamed = other.signBytes("pluginListing", bytes, signer.id);

    expect(openEnvelope(misnamed, { kind: "pluginListing", keys: both }).ok).toBe(false);
    expect(
      openEnvelope(other.sign("pluginListing", listing), { ...asListing, keys: both }).ok,
    ).toBe(true);
  });

  it("refuses a payload changed after it was signed", () => {
    const fields = fieldsOf(signer.sign("pluginListing", listing));
    const changed = asPayload(listingFixture({ hosts: ["api.example.com", "x.example.net"] }));
    const payload = Buffer.from(stableJson(changed)).toString("base64url");

    expect(isUnverified(JSON.stringify({ ...fields, payload }))).toBe(true);
  });

  it("refuses a revocation list's signature as a listing's, and a listing's as a list's", () => {
    const list = asPayload(revocationListFixture());

    expect(openEnvelope(signer.sign("pluginRevocations", list), asList).ok).toBe(true);
    expect(isUnverified(signer.sign("pluginRevocations", list))).toBe(true);
    expect(openEnvelope(signer.sign("pluginListing", listing), asList).ok).toBe(false);
  });

  it.each([
    ["a space", '{"kind": "pluginListing"}'],
    ["keys out of order", '{"version":1,"kind":"pluginListing"}'],
    ["a key twice", '{"kind":"pluginListing","kind":"pluginListing"}'],
    ["an escape for a plain letter", '{"kind":"plugin\\u004cisting"}'],
    ["a whole number written as 1.0", '{"version":1.0}'],
    ["a whole number written as 1e0", '{"version":1e0}'],
  ])("refuses a payload with %s, signed over its bytes", (_what, text) => {
    expect(isUnverified(signer.signBytes("pluginListing", encoder.encode(text)))).toBe(true);
  });

  it("opens the canonical form of a payload those refusals write another way", () => {
    const text = '{"kind":"pluginListing","version":1}';
    expect(isUnverified(signer.signBytes("pluginListing", encoder.encode(text)))).toBe(false);
  });

  it("refuses a signed payload whose bytes are not UTF-8", () => {
    const bytes = Uint8Array.of(0x22, 0xff, 0x22);
    expect(isUnverified(signer.signBytes("pluginListing", bytes))).toBe(true);
  });

  it("refuses a signed payload that starts with a byte-order mark", () => {
    const text = '{"kind":"pluginListing","version":1}';
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, ...encoder.encode(text));
    expect(isUnverified(signer.signBytes("pluginListing", bytes))).toBe(true);
  });

  it("refuses JSON nested past 64 levels inside a signed payload", () => {
    const deep = `${"[".repeat(65)}${"]".repeat(65)}`;
    expect(isUnverified(signer.signBytes("pluginListing", encoder.encode(deep)))).toBe(true);
  });

  it("refuses a payload or a signature with padding, the same bytes written another way", () => {
    const fields = fieldsOf(signer.sign("pluginListing", listing));
    const payload = JSON.stringify({ ...fields, payload: `${fields.payload}=` });
    const signature = JSON.stringify({ ...fields, signature: `${fields.signature}==` });

    expect(isUnverified(payload)).toBe(true);
    expect(isUnverified(signature)).toBe(true);
  });

  it("refuses a signature of 63 or 65 bytes before it is checked", () => {
    const fields = fieldsOf(signer.sign("pluginListing", listing));
    const bytes = Buffer.from(fields.signature, "base64url");
    const short = bytes.subarray(0, 63).toString("base64url");
    const long = Buffer.concat([bytes, Buffer.of(0)]).toString("base64url");

    expect(isUnverified(JSON.stringify({ ...fields, signature: short }))).toBe(true);
    expect(isUnverified(JSON.stringify({ ...fields, signature: long }))).toBe(true);
  });

  it("refuses an envelope with a field more, a field less or a field twice", () => {
    const text = signer.sign("pluginListing", listing);
    const fields = fieldsOf(text);
    const less = { key: fields.key, payload: fields.payload };

    expect(isUnverified(JSON.stringify({ ...fields, note: "x" }))).toBe(true);
    expect(isUnverified(JSON.stringify(less))).toBe(true);
    expect(isUnverified(text.replace('{"key"', `{"key":"${signer.id}","key"`))).toBe(true);
    expect(isUnverified("not json")).toBe(true);
  });

  it("refuses a payload past its kind's limit, and an envelope past its own", () => {
    const filler = `"${"a".repeat(payloadLimits.pluginListing - 1)}"`;
    const signed = signer.signBytes("pluginListing", encoder.encode(filler));
    const fields = fieldsOf(signed);

    expect(isUnverified(signed)).toBe(true);
    expect(isUnverified(JSON.stringify({ ...fields, note: "x".repeat(200_000) }))).toBe(true);
  });
});
