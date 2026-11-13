import { describe, expect, it } from "vitest";
import { z } from "zod";
import { listingStatement, openEnvelope } from "./listing-envelope.js";
import {
  asPayload,
  listingFixture,
  listingIdFixture,
  revocationListFixture,
} from "./listing-fixtures.js";
import { createListingKeys, listingKeyId } from "./listing-keys.js";
import { pluginListingSchema, revocationListSchema } from "./plugin-listing.schema.js";
import recorded from "./recorded/listing-vector.json" with { type: "json" };

// The vector holds a public key only; its private half never entered the repository
// (decision 0434), so no test here can sign again what it holds.
const signed = z.strictObject({ envelope: z.string(), digest: z.string(), statement: z.string() });
const vector = z
  .strictObject({
    key: z.strictObject({ spki: z.string(), id: z.string() }),
    listing: signed,
    revocations: signed,
  })
  .parse(recorded);
const keys = createListingKeys([vector.key.spki]);

// The payload of an envelope the keys open; one that does not open fails the test.
function payloadOf(envelope: string, kind: "pluginListing" | "pluginRevocations") {
  const opened = openEnvelope(envelope, { kind, keys });
  if (!opened.ok) {
    throw new Error(`Expected the recorded ${kind} to open.`);
  }
  return opened.value;
}

function payloadBytes(envelope: string): Uint8Array {
  const { payload } = z.object({ payload: z.string() }).parse(JSON.parse(envelope));
  return new Uint8Array(Buffer.from(payload, "base64url"));
}

describe("the recorded listing vector", () => {
  it("names its key by the id the key's public half gives", () => {
    expect(listingKeyId(Buffer.from(vector.key.spki, "base64url"))).toBe(vector.key.id);
    expect(keys.ids).toStrictEqual([vector.key.id]);
  });

  it("opens the recorded listing to the listing fixture, over the recorded statement", () => {
    const opened = payloadOf(vector.listing.envelope, "pluginListing");
    const statement = listingStatement(
      "pluginListing",
      vector.key.id,
      payloadBytes(vector.listing.envelope),
    );

    expect(opened.digest).toBe(vector.listing.digest);
    expect(pluginListingSchema.parse(opened.payload)).toStrictEqual(listingFixture());
    expect(Buffer.from(statement).toString("hex")).toBe(vector.listing.statement);
  });

  it("opens the recorded revocation list, over the recorded statement", () => {
    const opened = payloadOf(vector.revocations.envelope, "pluginRevocations");
    const statement = listingStatement(
      "pluginRevocations",
      vector.key.id,
      payloadBytes(vector.revocations.envelope),
    );
    const expected = revocationListFixture({ sequence: 7, revoked: [listingIdFixture(2)] });

    expect(opened.digest).toBe(vector.revocations.digest);
    expect(opened.payload).toStrictEqual(asPayload(expected));
    expect(revocationListSchema.parse(opened.payload)).toStrictEqual(expected);
    expect(Buffer.from(statement).toString("hex")).toBe(vector.revocations.statement);
  });
});
