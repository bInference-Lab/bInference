import { createMemoryLogger, createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createListingSigner } from "./fake-listing-signer.js";
import { createFakePluginCatalog } from "./fake-plugin-catalog.js";
import {
  asPayload,
  listedEntryFixture,
  listingFixture,
  listingIdFixture,
  memoryPluginRecords,
} from "./listing-fixtures.js";
import { createListingGate, type ListingGate } from "./listing-gate.js";
import { createListingKeys } from "./listing-keys.js";

const startMs = 1_767_261_600_000;
const signal = new AbortController().signal;
const listing = listingFixture();
const source = {
  name: listing.packageName,
  version: listing.packageVersion,
  integrity: listing.integrity,
};

function gateOver() {
  const clock = createManualClock(startMs);
  const catalog = createFakePluginCatalog({ clock });
  const logger = createMemoryLogger({ subsystem: "plugins" });
  const keys = createListingKeys([catalog.signer.spki]);
  const records = memoryPluginRecords();
  const gate = createListingGate({
    rule: { kind: "required", keys, catalog },
    clock,
    logger,
    records,
  });
  return { clock, catalog, gate, logger };
}

const entry = listedEntryFixture();

describe("the listing gate before an add", () => {
  it("answers the newest version of the one listing a package version has", async () => {
    const { catalog, gate } = gateOver();
    catalog.list(listing);
    catalog.list({ ...listing, version: 2 });

    await expect(gate.forPackage(source, signal)).resolves.toStrictEqual({
      ok: true,
      value: { ...listing, version: 2 },
    });
  });

  it("refuses a package version no listing names", async () => {
    const { gate } = gateOver();
    await expect(gate.forPackage(source, signal)).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.not_listed" },
    });
  });

  it("refuses a listing another key signed", async () => {
    const { catalog, gate } = gateOver();
    catalog.serveListing(listing, createListingSigner().sign("pluginListing", asPayload(listing)));

    await expect(gate.forPackage(source, signal)).resolves.toMatchObject({
      failure: { code: "plugin.listing_unverified" },
    });
  });

  it("refuses a listing the revocation list names", async () => {
    const { catalog, gate } = gateOver();
    catalog.list(listing);
    catalog.revoke(listing.listing);

    await expect(gate.forPackage(source, signal)).resolves.toMatchObject({
      failure: { code: "plugin.listing_revoked" },
    });
  });

  it("refuses an integrity other than the listing's before anything is fetched", async () => {
    const { catalog, gate } = gateOver();
    catalog.list(listing);
    const other = { ...source, integrity: `sha512-${Buffer.alloc(64, 9).toString("base64")}` };

    await expect(gate.forPackage(other, signal)).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.listing_mismatch", field: "integrity" },
    });
  });

  it("answers bad_answer for two listings of one package version, or one of another package", async () => {
    const { catalog, gate } = gateOver();
    catalog.list(listing);
    catalog.list({ ...listing, listing: listingIdFixture(2) });
    const second = gateOver();
    second.catalog.serveListing(
      listing,
      second.catalog.signer.sign(
        "pluginListing",
        asPayload({ ...listing, packageVersion: "2.0.0" }),
      ),
    );

    await expect(gate.forPackage(source, signal)).resolves.toMatchObject({
      failure: { code: "plugin.listings_unreachable", reason: "bad_answer" },
    });
    await expect(second.gate.forPackage(source, signal)).resolves.toMatchObject({
      failure: { code: "plugin.listings_unreachable", reason: "bad_answer" },
    });
  });

  it("answers bad_answer for more than 8 envelopes of one package version", async () => {
    const { catalog, gate } = gateOver();
    const other = createListingSigner();
    catalog.list(listing);
    const eight = Array.from({ length: 8 }, (_, index) => listingIdFixture(index + 2));
    for (const id of eight) {
      const extra = { ...listing, listing: id };
      catalog.serveListing(extra, other.sign("pluginListing", asPayload(extra)));
    }

    await expect(gate.forPackage(source, signal)).resolves.toMatchObject({
      failure: { code: "plugin.listings_unreachable", reason: "bad_answer" },
    });
  });

  it("answers unreachable within 15 seconds on the clock when the catalog drops its signal", async () => {
    const { catalog, clock, gate } = gateOver();
    catalog.list(listing);
    await gate.forPackage(source, signal);
    catalog.goDown("stall");
    const adding = gate.forPackage(source, signal);
    const checking = gate.forEntry(entry, signal);
    const reading = gate.refresh(signal);
    await clock.advance(15_000);

    await expect(reading).resolves.toStrictEqual({ ok: false, error: "unreachable" });

    await expect(adding).resolves.toMatchObject({
      failure: { code: "plugin.listings_unreachable", reason: "unreachable" },
    });
    await expect(checking).resolves.toMatchObject({
      failure: { code: "plugin.listings_unreachable", reason: "unreachable" },
    });
  });

  it("answers unreachable when the catalog cannot be read, and within 15 seconds when it hangs", async () => {
    const { catalog, clock, gate } = gateOver();
    catalog.goDown("refuse");
    const refused = await gate.forPackage(source, signal);
    catalog.goDown("hang");
    const waiting = gate.forPackage(source, signal);
    await clock.advance(15_000);

    expect(refused).toMatchObject({ failure: { reason: "unreachable" } });
    await expect(waiting).resolves.toMatchObject({
      failure: { code: "plugin.listings_unreachable", reason: "unreachable" },
    });
  });

  it("answers stale when the catalog's newest list has expired, and logs why", async () => {
    const { catalog, clock, gate, logger } = gateOver();
    catalog.list(listing);
    await clock.advance(3_600_000);

    await expect(gate.forPackage(source, signal)).resolves.toMatchObject({
      failure: { code: "plugin.listings_unreachable", reason: "stale" },
    });
    expect(logger.records()).toContainEqual(
      expect.objectContaining({
        event: "plugin.revocations_refused",
        fields: { reason: "expired" },
      }),
    );
  });

  it("reads the revocation list again only once the one it holds has expired", async () => {
    const { catalog, clock, gate } = gateOver();
    catalog.list(listing);
    await gate.forPackage(source, signal);
    await gate.forPackage(source, signal);
    const before = catalog.reads().filter((read) => read === "revocations").length;
    await clock.advance(3_600_000);
    catalog.renew();
    await gate.forPackage(source, signal);

    expect(before).toBe(1);
    expect(catalog.reads().filter((read) => read === "revocations")).toHaveLength(2);
  });
});

describe("the listing gate for an installed plugin", () => {
  it("answers its listing when it equals the entry", async () => {
    const { catalog, gate } = gateOver();
    catalog.list(listing);
    await expect(gate.forEntry(entry, signal)).resolves.toStrictEqual({ ok: true, value: listing });
  });

  it("names the field where the listing says another thing than the entry", async () => {
    const { catalog, gate } = gateOver();
    catalog.list({ ...listing, hosts: ["api.example.com", "x.example.net"] });
    await expect(gate.forEntry(entry, signal)).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.listing_mismatch", field: "hosts" },
    });
  });

  it("answers bad_answer for a version below the entry's, or for another listing", async () => {
    const { catalog, gate } = gateOver();
    catalog.list(listing);
    const newer = { ...entry, listing: { listing: listing.listing, version: 2 } };
    const second = gateOver();
    second.catalog.serveListing(
      listing,
      second.catalog.signer.sign(
        "pluginListing",
        asPayload({ ...listing, listing: listingIdFixture(3) }),
      ),
    );

    await expect(gate.forEntry(newer, signal)).resolves.toMatchObject({
      failure: { reason: "bad_answer" },
    });
    await expect(second.gate.forEntry(entry, signal)).resolves.toMatchObject({
      failure: { reason: "bad_answer" },
    });
  });

  it("refuses an entry with no listing, and one whose listing the catalog no longer serves", async () => {
    const { gate } = gateOver();
    const { listing: _none, ...unlisted } = entry;

    await expect(gate.forEntry(unlisted, signal)).resolves.toMatchObject({
      failure: { code: "plugin.not_listed" },
    });
    await expect(gate.forEntry(entry, signal)).resolves.toMatchObject({
      failure: { code: "plugin.not_listed" },
    });
  });

  it("tells whether the newest list it took names a listing, after that list expired too", async () => {
    const { catalog, clock, gate } = gateOver();
    catalog.list(listing);
    catalog.revoke(listing.listing);
    await gate.forEntry(entry, signal);
    await clock.advance(3_600_000);

    expect(gate.revocations.fresh()).toBeUndefined();
    expect(gate.isRevoked(listing.listing)).toBe(true);
    expect(gate.isRevoked(listingIdFixture(2))).toBe(false);
  });

  it("refuses an entry the lock marks revoked before it asks the catalog anything", async () => {
    const { catalog, gate } = gateOver();
    catalog.list(listing);
    const marked = listedEntryFixture({
      enabled: false,
      listing: { listing: listing.listing, version: 1, revoked: true },
    });

    await expect(gate.forEntry(marked, signal)).resolves.toStrictEqual({
      ok: false,
      failure: { code: "plugin.listing_revoked" },
    });
    expect(catalog.reads()).toStrictEqual([]);
  });

  it.each([
    ["get", async (gate: ListingGate) => gate.forEntry(entry, signal)],
    ["find", async (gate: ListingGate) => gate.forPackage(source, signal)],
  ] as const)(
    "refuses a listing a list taken while its %s read waited names",
    async (kind, check) => {
      const { catalog, gate } = gateOver();
      catalog.list(listing);
      await gate.refresh(signal);
      const held = catalog.holdReads(kind);
      const checking = check(gate);
      await held.arrived;
      catalog.revoke(listing.listing);
      await gate.refresh(signal);
      held.release();

      await expect(checking).resolves.toStrictEqual({
        ok: false,
        failure: { code: "plugin.listing_revoked" },
      });
    },
  );
});
