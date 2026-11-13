import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakePluginCatalog } from "../plugins/fake-plugin-catalog.js";
import {
  listedEntryFixture,
  listingFixture,
  memoryPluginRecords,
} from "../plugins/listing-fixtures.js";
import { createListingGate } from "../plugins/listing-gate.js";
import { createListingKeys } from "../plugins/listing-keys.js";
import { switchedLock } from "./listed-enable.js";

const signal = new AbortController().signal;
const listing = listingFixture();
const off = listedEntryFixture({ enabled: false, disabledReason: "owner" });

function gateOver() {
  const clock = createManualClock(1_767_261_600_000);
  const catalog = createFakePluginCatalog({ clock });
  const keys = createListingKeys([catalog.signer.spki]);
  const logger = createMemoryLogger({ subsystem: "plugins" });
  return {
    catalog,
    gate: createListingGate({
      rule: { kind: "required", keys, catalog },
      clock,
      logger,
      records: memoryPluginRecords(),
    }),
  };
}

const turnOn = { plugin: off.plugin, enabled: true, quota: undefined, listing: undefined };

describe("the lock an enable writes", () => {
  it("refuses an entry the lock marks revoked, though the newest list does not name it", async () => {
    const { gate } = gateOver();
    await gate.refresh(signal);
    const marked = {
      ...off,
      listing: { listing: listing.listing, version: 1, revoked: true as const },
    };
    const lock = { plugins: [marked] };

    expect(switchedLock({ gate, lock }, turnOn)).toStrictEqual({ lock, refusal: "revoked" });
  });

  it("refuses an entry whose listing the newest list the gate took names", async () => {
    const { catalog, gate } = gateOver();
    catalog.revoke(listing.listing);
    await gate.refresh(signal);
    const lock = { plugins: [off] };

    expect(switchedLock({ gate, lock }, turnOn)).toStrictEqual({ lock, refusal: "revoked" });
  });

  it("turns on an entry neither names, and turns off a marked one as the owner asks", async () => {
    const { gate } = gateOver();
    await gate.refresh(signal);
    const marked = {
      ...off,
      enabled: true,
      listing: { listing: listing.listing, version: 1, revoked: true as const },
    };

    expect(switchedLock({ gate, lock: { plugins: [off] } }, turnOn)).toMatchObject({
      lock: { plugins: [{ enabled: true }] },
    });
    expect(
      switchedLock({ gate, lock: { plugins: [marked] } }, { ...turnOn, enabled: false }),
    ).toMatchObject({ lock: { plugins: [{ enabled: false, disabledReason: "owner" }] } });
  });
});
