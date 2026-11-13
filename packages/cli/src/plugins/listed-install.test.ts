import { join } from "node:path";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import type { PluginReview } from "@binference/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { createListingSigner } from "./fake-listing-signer.js";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "./fake-npm-registry.js";
import { createFakePluginCatalog, type FakePluginCatalog } from "./fake-plugin-catalog.js";
import { readPluginSource } from "./fetch-plugin.js";
import { createInstallHarness, type InstallHarness } from "./install-harness.js";
import { installPlugin } from "./install-plugin.js";
import { asPayload, listingFixture } from "./listing-fixtures.js";
import { createListingGate, type ListingGate } from "./listing-gate.js";
import { createListingKeys } from "./listing-keys.js";
import type { PluginListing } from "./plugin-listing.schema.js";

let http: SystemHttp;
let registry: FakeNpmRegistry;
let folder: TempFolder;

beforeAll(async () => {
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
  folder = await createTempFolder("listed-install-");
});

afterAll(async () => {
  await registry.close();
  await http.close();
  await folder.remove();
});

const startMs = 1_767_261_600_000;
const signal = new AbortController().signal;
const manifest: CommunityManifest = {
  api: 1,
  id: "echo-feed",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: ["api.example.com"],
  tools: [
    {
      name: "echo",
      description: "Answers its text.",
      input: { type: "object", properties: {}, additionalProperties: false },
      output: { type: "object" },
    },
  ],
};
const index = {
  path: "index.mjs",
  text: "export const tools = { echo: async (input) => input };\n",
};

interface Listed {
  readonly catalog: FakePluginCatalog;
  readonly gate: ListingGate;
  readonly harness: InstallHarness;
}

// An install over its own folder, the fake registry and a catalog whose key the gate holds.
function listedInstall(name: string): Listed {
  const clock = createManualClock(startMs);
  const catalog = createFakePluginCatalog({ clock });
  const keys = createListingKeys([catalog.signer.spki]);
  const logger = createMemoryLogger({ subsystem: "plugins" });
  const gate = createListingGate({ rule: { kind: "required", keys, catalog }, clock, logger });
  const base = { registryBase: registry.base, http, clock, listing: gate };
  return {
    catalog,
    gate,
    harness: createInstallHarness({ ...base, folder: join(folder.path, name) }),
  };
}

function answersOf(version: string, hash: string, extra: { accepted?: string } = {}) {
  const source = `npm:echo-feed@${version}`;
  const from = readPluginSource(source, hash);
  if (!from.ok) {
    throw new Error("Expected an npm source.");
  }
  return { source, from: from.value, typedName: "echo-feed", ...extra };
}

// The review of a version as an install with no listing rule shows it.
async function reviewOf(version: string, hash: string): Promise<PluginReview> {
  const clock = createManualClock(startMs);
  const harness = createInstallHarness({
    registryBase: registry.base,
    http,
    clock,
    folder: join(folder.path, `review-${version}`),
  });
  const answer = await installPlugin(harness.parts, answersOf(version, hash), signal);
  if (answer.ok || answer.failure.code !== "plugin.review_needed") {
    throw new Error("Expected a review.");
  }
  return answer.failure.review;
}

// The listing the catalog would sign for a version, from what its review read.
function listingOf(review: PluginReview, hash: string): PluginListing {
  return listingFixture({
    packageName: "echo-feed",
    packageVersion: review.version,
    integrity: hash,
    files: review.hash,
    plugin: review.plugin,
    provenance: review.provenance,
    ...(review.publisher === undefined ? {} : { publisher: review.publisher }),
    kinds: review.kinds,
    hosts: review.hosts,
    tools: review.tools,
    configKeys: review.configKeys,
  });
}

let counter = 0;
// Publishes the next version and answers it with its integrity.
function published(): { readonly version: string; readonly hash: string } {
  counter += 1;
  const version = `1.0.${String(counter)}`;
  return {
    version,
    hash: registry.publish({ name: "echo-feed", version, files: [index], manifest }),
  };
}

const asked = (version: string): number =>
  registry.requests().filter((path) => path.includes(`echo-feed/${version}`)).length;

describe("installing a plugin under the listing rule", () => {
  it("installs a listed version after the owner's review, which names the listing", async () => {
    const { version, hash } = published();
    const plain = await reviewOf(version, hash);
    const listing = listingOf(plain, hash);
    const { catalog, harness } = listedInstall("listed");
    catalog.list(listing);

    const review = await installPlugin(harness.parts, answersOf(version, hash), signal);
    const done = await installPlugin(
      harness.parts,
      answersOf(version, hash, { accepted: plain.digest }),
      signal,
    );

    expect(review).toMatchObject({
      ok: false,
      failure: {
        code: "plugin.review_needed",
        review: { ...plain, listing: { listing: listing.listing, version: 1 } },
      },
    });
    expect(done).toMatchObject({
      ok: true,
      value: { enabled: true, listing: { listing: listing.listing, version: 1 } },
    });
  });

  it("refuses a version no listing names before it fetches anything", async () => {
    const { version, hash } = published();
    const { harness } = listedInstall("unlisted");

    await expect(
      installPlugin(harness.parts, answersOf(version, hash), signal),
    ).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.not_listed" },
    });
    expect(asked(version)).toBe(0);
  });

  it("refuses a hash other than the listing's before it fetches anything", async () => {
    const { version, hash } = published();
    const listing = listingOf(await reviewOf(version, hash), hash);
    const { catalog, harness } = listedInstall("other-hash");
    catalog.list({ ...listing, integrity: `sha512-${Buffer.alloc(64, 3).toString("base64")}` });
    const before = asked(version);

    await expect(
      installPlugin(harness.parts, answersOf(version, hash), signal),
    ).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.listing_mismatch", field: "integrity" },
    });
    expect(asked(version)).toBe(before);
  });

  it.each([
    ["files", { files: "f".repeat(64) }],
    ["publisher", { publisher: "someone-else" }],
    ["hosts", { hosts: ["api.example.com", "x.example.net"] }],
  ] as const)(
    "refuses a fetched package whose %s differs from its listing",
    async (field, change) => {
      const { version, hash } = published();
      const listing = listingOf(await reviewOf(version, hash), hash);
      const { catalog, harness } = listedInstall(`differs-${field}`);
      catalog.list({ ...listing, ...change });

      await expect(
        installPlugin(harness.parts, answersOf(version, hash), signal),
      ).resolves.toStrictEqual({
        ok: false,
        failure: { code: "plugin.listing_mismatch", field },
      });
    },
  );

  it("refuses a listing another key signed before it fetches anything", async () => {
    const { version, hash } = published();
    const listing = listingOf(await reviewOf(version, hash), hash);
    const { catalog, harness } = listedInstall("other-key");
    catalog.serveListing(listing, createListingSigner().sign("pluginListing", asPayload(listing)));
    const before = asked(version);

    await expect(
      installPlugin(harness.parts, answersOf(version, hash), signal),
    ).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.listing_unverified" },
    });
    expect(asked(version)).toBe(before);
  });

  it("refuses a revoked listing before it fetches anything", async () => {
    const { version, hash } = published();
    const listing = listingOf(await reviewOf(version, hash), hash);
    const { catalog, harness } = listedInstall("revoked");
    catalog.list(listing);
    catalog.revoke(listing.listing);
    const before = asked(version);

    await expect(
      installPlugin(harness.parts, answersOf(version, hash), signal),
    ).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.listing_revoked" },
    });
    expect(asked(version)).toBe(before);
  });

  it("writes off as revoked a plugin whose listing the list names once its files are in place", async () => {
    const { version, hash } = published();
    const plain = await reviewOf(version, hash);
    const { catalog, gate, harness } = listedInstall("revoked-late");
    catalog.list(listingOf(plain, hash));
    const parts = { ...harness.parts, listing: { ...gate, isRevoked: () => true } };

    const done = await installPlugin(
      parts,
      answersOf(version, hash, { accepted: plain.digest }),
      signal,
    );
    const lock = await harness.parts.records.read(signal);

    expect(done.ok).toBe(true);
    expect(lock.plugins).toMatchObject([{ enabled: false, disabledReason: "revoked" }]);
  });

  it("refuses an update to a version with no listing of its own, the installed one kept", async () => {
    const first = published();
    const plain = await reviewOf(first.version, first.hash);
    const { catalog, harness } = listedInstall("update");
    catalog.list(listingOf(plain, first.hash));
    await installPlugin(
      harness.parts,
      answersOf(first.version, first.hash, { accepted: plain.digest }),
      signal,
    );
    const next = published();

    const update = await installPlugin(harness.parts, answersOf(next.version, next.hash), signal);
    const lock = await harness.parts.records.read(signal);

    expect(update).toStrictEqual({ ok: false, failure: { code: "plugin.not_listed" } });
    expect(lock.plugins).toMatchObject([{ version: first.version, enabled: true }]);
  });
});
