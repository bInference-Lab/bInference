import { describe, expect, it } from "vitest";
import { factsOfEntry, type ListedFacts, listingFields, listingMismatch } from "./listing-facts.js";
import { listingFixture } from "./listing-fixtures.js";
import type { LockedPlugin } from "./plugin-lock.js";

const listing = listingFixture({
  provenance: "verified",
  publisher: "github.com/a/b",
  issuer: "https://token.actions.githubusercontent.com",
  workflow: "github.com/c/d/.github/workflows/release.yml",
});
const { kind: _kind, listing: _id, version: _version, issuedAt: _issued, ...facts } = listing;

const changed: Readonly<Record<(typeof listingFields)[number], Partial<ListedFacts>>> = {
  packageName: { packageName: "echo-feeds" },
  packageVersion: { packageVersion: "1.0.1" },
  integrity: { integrity: `sha512-${Buffer.alloc(64, 8).toString("base64")}` },
  files: { files: "b".repeat(64) },
  plugin: { plugin: "echo-feeds" },
  provenance: { provenance: "none" },
  publisher: { publisher: "github.com/a/c" },
  issuer: { issuer: "https://gitlab.com" },
  workflow: { workflow: "github.com/c/e/.github/workflows/release.yml" },
  kinds: { kinds: ["data", "skills"] },
  hosts: { hosts: [] },
  tools: { tools: ["echo", "shout"] },
  configKeys: { configKeys: ["days"] },
};

describe("comparing a listing with what a plugin holds", () => {
  it("finds no field when every field is equal", () => {
    expect(listingMismatch(listing, facts)).toBeUndefined();
  });

  it.each(listingFields)("names %s when it alone differs", (field) => {
    expect(listingMismatch(listing, { ...facts, ...changed[field] })).toBe(field);
  });

  it("names the first field in the order of the comparison when two differ", () => {
    const both = { ...facts, ...changed.tools, ...changed.integrity };
    expect(listingMismatch(listing, both)).toBe("integrity");
  });

  it("tells a missing publisher, issuer or workflow from any name", () => {
    const { workflow: _dropped, ...noWorkflow } = facts;
    expect(listingMismatch(listing, noWorkflow)).toBe("workflow");
    expect(listingMismatch(listing, { ...facts, publisher: "" })).toBe("publisher");
  });

  it("reads an installed plugin's entry as the lock stores it", () => {
    const entry: LockedPlugin = {
      plugin: "plg_0190f1c2-3a4b-7c5d-8e6f-000000000001",
      id: "echo-feed",
      packageName: "echo-feed",
      version: "1.0.0",
      source: "npm:echo-feed@1.0.0",
      integrity: listing.integrity,
      hash: listing.files,
      manifest: {
        api: 1,
        id: "echo-feed",
        kinds: ["data"],
        entry: "index.mjs",
        hosts: ["api.example.com"],
        tools: [
          {
            name: "echo",
            description: "Echo.",
            input: { type: "object" },
            output: { type: "object" },
          },
        ],
      },
      accepted: "c".repeat(64),
      provenance: "verified",
      publisher: "github.com/a/b",
      issuer: "https://token.actions.githubusercontent.com",
      workflow: "github.com/c/d/.github/workflows/release.yml",
      enabled: true,
      installedAt: 1,
    };
    expect(factsOfEntry(entry)).toStrictEqual(facts);
  });
});
