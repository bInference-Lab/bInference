import { idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import type { PluginListing, RevocationList } from "./plugin-listing.schema.js";

/** A plugin listing's id for tests: the `n`th of a fixed run of UUIDv7 ids. */
export function listingIdFixture(n: number): PluginListing["listing"] {
  const tail = n.toString(16).padStart(12, "0");
  return idSchema("pls").parse(`pls_0190f1c2-3a4b-7c5d-8e6f-${tail}`);
}

/** A plugin listing that every check passes, with `overrides` over it. */
export function listingFixture(overrides: Partial<PluginListing> = {}): PluginListing {
  return {
    kind: "pluginListing",
    listing: listingIdFixture(1),
    version: 1,
    issuedAt: 1_767_261_600_000,
    packageName: "echo-feed",
    packageVersion: "1.0.0",
    integrity: `sha512-${Buffer.alloc(64, 7).toString("base64")}`,
    files: "a".repeat(64),
    plugin: "echo-feed",
    provenance: "none",
    publisher: "fake-publisher",
    kinds: ["data"],
    hosts: ["api.example.com"],
    tools: ["echo"],
    configKeys: [],
    ...overrides,
  };
}

/** A revocation list good for an hour from `issuedAt`, with `overrides` over it. */
export function revocationListFixture(overrides: Partial<RevocationList> = {}): RevocationList {
  const issuedAt = overrides.issuedAt ?? 1_767_261_600_000;
  return {
    kind: "pluginRevocations",
    sequence: 1,
    issuedAt,
    expiresAt: issuedAt + 3_600_000,
    revoked: [],
    ...overrides,
  };
}

/** A listing or a list as the JSON a signer signs. */
export function asPayload(value: PluginListing | RevocationList): JsonValue {
  return jsonValueSchema.parse(value);
}
