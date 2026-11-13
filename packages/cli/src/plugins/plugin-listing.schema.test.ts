import { describe, expect, it } from "vitest";
import {
  asPayload,
  listingFixture,
  listingIdFixture,
  revocationListFixture,
} from "./listing-fixtures.js";
import { pluginListingSchema, revocationListSchema } from "./plugin-listing.schema.js";

describe("a plugin listing's payload", () => {
  it("reads a listing, verified or not", () => {
    const verified = listingFixture({
      provenance: "verified",
      publisher: "github.com/a/b",
      issuer: "https://token.actions.githubusercontent.com",
    });
    expect(pluginListingSchema.parse(asPayload(listingFixture()))).toStrictEqual(listingFixture());
    expect(pluginListingSchema.parse(asPayload(verified))).toStrictEqual(verified);
  });

  it.each([
    ["hosts out of order", { hosts: ["b.example.com", "a.example.com"] }],
    ["a host twice", { hosts: ["a.example.com", "a.example.com"] }],
    ["an issuer without provenance", { issuer: "https://gitlab.com" }],
    ["a workflow without provenance", { workflow: "github.com/a/b/.github/workflows/x.yml" }],
    ["a version of 0", { version: 0 }],
    ["an id of another kind", { listing: "plg_0190f1c2-3a4b-7c5d-8e6f-000000000001" }],
    ["17 hosts", { hosts: Array.from({ length: 17 }, (_, n) => `h${String(n + 10)}.example`) }],
  ])("refuses %s", (_what, overrides) => {
    const payload = { ...listingFixture(), ...overrides };
    expect(pluginListingSchema.safeParse(payload).success).toBe(false);
  });

  it("refuses a field it does not name", () => {
    const payload = { ...listingFixture(), note: "x" };
    expect(pluginListingSchema.safeParse(payload).success).toBe(false);
  });
});

describe("a revocation list's payload", () => {
  it("reads a list good for an hour", () => {
    const list = revocationListFixture({ revoked: [listingIdFixture(1), listingIdFixture(2)] });
    expect(revocationListSchema.parse(asPayload(list))).toStrictEqual(list);
  });

  it.each([
    ["good for an hour and a millisecond", { expiresAt: 1_767_265_200_001 }],
    ["good for no time", { expiresAt: 1_767_261_600_000 }],
    ["listings out of order", { revoked: [listingIdFixture(2), listingIdFixture(1)] }],
    ["a listing twice", { revoked: [listingIdFixture(1), listingIdFixture(1)] }],
    ["a sequence of 0", { sequence: 0 }],
  ])("refuses a list %s", (_what, overrides) => {
    const payload = { ...revocationListFixture(), ...overrides };
    expect(revocationListSchema.safeParse(payload).success).toBe(false);
  });

  it("refuses more than 10,000 listings", () => {
    const revoked = Array.from({ length: 10_001 }, (_, n) => listingIdFixture(n + 1));
    const payload = asPayload(revocationListFixture({ revoked }));
    expect(revocationListSchema.safeParse(payload).success).toBe(false);
  });
});
