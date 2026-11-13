import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakePluginCatalog } from "./fake-plugin-catalog.js";
import { openEnvelope } from "./listing-envelope.js";
import { listingIdFixture } from "./listing-fixtures.js";
import { createListingKeys } from "./listing-keys.js";
import { pluginListingCatalogContract } from "./plugin-listing-catalog-contract.js";
import { revocationListSchema } from "./plugin-listing.schema.js";

const startMs = 1_767_261_600_000;

function subjectOf(catalog: ReturnType<typeof createFakePluginCatalog>) {
  return { catalog, keys: createListingKeys([catalog.signer.spki]) };
}

// The revocation list the catalog answers now, opened.
async function listNow(catalog: ReturnType<typeof createFakePluginCatalog>) {
  const answer = await catalog.revocations(new AbortController().signal);
  const keys = createListingKeys([catalog.signer.spki]);
  const opened = answer.ok
    ? openEnvelope(answer.value, { kind: "pluginRevocations", keys })
    : { ok: false as const };
  return opened.ok ? revocationListSchema.parse(opened.value.payload) : undefined;
}

describe("the fake listing catalog", () => {
  it.each(
    pluginListingCatalogContract({
      create: async (listings) => {
        const catalog = createFakePluginCatalog({ clock: createManualClock(startMs) });
        for (const listing of listings) {
          catalog.list(listing);
        }
        return Promise.resolve(subjectOf(catalog));
      },
      createDown: async () => {
        const catalog = createFakePluginCatalog({ clock: createManualClock(startMs) });
        catalog.goDown("refuse");
        return Promise.resolve(subjectOf(catalog));
      },
      createHanging: async () => {
        const catalog = createFakePluginCatalog({ clock: createManualClock(startMs) });
        catalog.goDown("hang");
        return Promise.resolve(subjectOf(catalog));
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("signs each next revocation list at the clock's time, keeping what it revoked", async () => {
    const clock = createManualClock(startMs);
    const catalog = createFakePluginCatalog({ clock });
    await clock.advance(60_000);
    catalog.revoke(listingIdFixture(2));
    await clock.advance(60_000);
    catalog.renew();

    await expect(listNow(catalog)).resolves.toStrictEqual({
      kind: "pluginRevocations",
      sequence: 3,
      issuedAt: startMs + 120_000,
      expiresAt: startMs + 120_000 + 3_600_000,
      revoked: [listingIdFixture(2)],
    });
    expect(catalog.signedLists()).toHaveLength(3);
  });

  it("answers a read only once its signal aborts while it hangs", async () => {
    const catalog = createFakePluginCatalog({ clock: createManualClock(startMs) });
    catalog.goDown("hang");
    const stop = new AbortController();
    const reading = catalog.revocations(stop.signal);
    stop.abort();

    await expect(reading).resolves.toStrictEqual({ ok: false, error: "unreachable" });
    expect(catalog.reads()).toStrictEqual(["revocations"]);
  });
});
