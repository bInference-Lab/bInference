import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakePluginCatalog } from "./fake-plugin-catalog.js";
import { createListedRunner } from "./listed-runner.js";
import { listedEntryFixture, listingFixture, memoryPluginRecords } from "./listing-fixtures.js";
import { createListingGate } from "./listing-gate.js";
import { createListingKeys } from "./listing-keys.js";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";
import type { PluginRunner } from "./plugin-runner.js";

const startMs = 1_767_261_600_000;
const listing = listingFixture();

const entryOf = (id: string, overrides: Partial<LockedPlugin> = {}): LockedPlugin => {
  const entry = listedEntryFixture(overrides);
  return { ...entry, id, manifest: { ...entry.manifest, id } };
};

// The plugins a lock has on, as a runner sees them.
const names = (lock: PluginLock): string =>
  lock.plugins
    .filter(({ enabled }) => enabled)
    .map(({ id }) => id)
    .join(",");

// A runner that records what it was asked to start, run, stop and offer.
function recordingRunner() {
  const asked: string[] = [];
  const runner: PluginRunner = {
    begin: async (lock) => {
      asked.push(`begin ${names(lock)}`);
      return Promise.resolve(true);
    },
    run: async (entry) => {
      asked.push(`run ${entry.id}`);
      return Promise.resolve();
    },
    stop: async (id) => {
      asked.push(`stop ${id}`);
      return Promise.resolve();
    },
    call: async () => Promise.resolve({ ok: false, error: "unknown_plugin" }),
    offer: async (lock) => {
      asked.push(`offer ${names(lock)}`);
      return Promise.resolve();
    },
  };
  return { runner, asked };
}

function listedRunner() {
  const clock = createManualClock(startMs);
  const catalog = createFakePluginCatalog({ clock });
  const keys = createListingKeys([catalog.signer.spki]);
  const logger = createMemoryLogger({ subsystem: "plugins" });
  const rule = { kind: "required", keys, catalog } as const;
  const gate = createListingGate({ rule, clock, logger, records: memoryPluginRecords() });
  const inner = recordingRunner();
  const life = new AbortController().signal;
  return {
    clock,
    catalog,
    logger,
    asked: inner.asked,
    runner: createListedRunner({ runner: inner.runner, gate, logger, life }),
  };
}

describe("running plugins under the listing rule", () => {
  it("starts a plugin whose listing passes and holds one whose listing does not", async () => {
    const { catalog, logger, asked, runner } = listedRunner();
    catalog.list(listing);
    const { listing: _none, ...unlisted } = entryOf("other-feed");
    const lock = { plugins: [entryOf("echo-feed"), unlisted] };

    await runner.begin(lock);
    await runner.offer(lock);

    expect(asked).toStrictEqual(["begin echo-feed", "offer echo-feed"]);
    expect(runner.isHeld("other-feed")).toBe(true);
    expect(runner.isHeld("echo-feed")).toBe(false);
    expect(logger.records()).toContainEqual(
      expect.objectContaining({
        event: "plugin.listing_held",
        fields: { sourceId: "other-feed", reason: "plugin.not_listed" },
      }),
    );
  });

  it("holds every plugin while the catalog cannot be read, and runs one only once a check passes", async () => {
    const { catalog, asked, runner } = listedRunner();
    catalog.list(listing);
    catalog.goDown("refuse");
    const lock = { plugins: [entryOf("echo-feed")] };

    await runner.begin(lock);
    await runner.run(entryOf("echo-feed"));
    const heldAfterRun = runner.isHeld("echo-feed");
    catalog.comeBack();
    const resumed = await runner.resume(entryOf("echo-feed"));
    await runner.offer(lock);

    expect(heldAfterRun).toBe(true);
    expect(resumed).toBe(true);
    expect(asked).toStrictEqual(["begin ", "run echo-feed", "offer echo-feed"]);
    expect(runner.isHeld("echo-feed")).toBe(false);
  });

  it("starts nothing for a plugin with no fresh revocation list, and holds it", async () => {
    const { catalog, clock, asked, runner } = listedRunner();
    catalog.list(listing);
    await runner.begin({ plugins: [] });
    await clock.advance(3_600_000);
    catalog.goDown("refuse");

    await runner.run(entryOf("echo-feed"));

    expect(asked).toStrictEqual(["begin "]);
    expect(runner.isHeld("echo-feed")).toBe(true);
  });

  it("resumes no plugin an operation stopped since, nor another entry than the one held", async () => {
    const { catalog, asked, runner } = listedRunner();
    catalog.list(listing);
    catalog.goDown("refuse");
    await runner.begin({ plugins: [entryOf("echo-feed"), entryOf("other-feed")] });
    catalog.comeBack();
    await runner.stop("echo-feed");

    const stopped = await runner.resume(entryOf("echo-feed"));
    const other = await runner.resume(entryOf("other-feed", { version: "9.9.9" }));

    expect([stopped, other]).toStrictEqual([false, false]);
    expect(asked).toStrictEqual(["begin ", "stop echo-feed"]);
  });

  it("checks the listings at the start that runs the plugins only, never at a later begin", async () => {
    const { catalog, asked, runner } = listedRunner();
    catalog.list(listing);
    const lock = { plugins: [entryOf("echo-feed")] };
    await runner.begin(lock);
    catalog.goDown("refuse");

    await runner.begin(lock);
    await runner.offer(lock);

    expect(runner.isHeld("echo-feed")).toBe(false);
    expect(asked).toStrictEqual(["begin echo-feed", "offer echo-feed"]);
  });

  it("stops a plugin it holds and offers its tools no more", async () => {
    const { catalog, asked, runner } = listedRunner();
    catalog.list(listing);
    const lock = { plugins: [entryOf("echo-feed")] };
    await runner.begin(lock);

    await runner.hold(entryOf("echo-feed"));
    await runner.offer(lock);

    expect(asked).toStrictEqual(["begin echo-feed", "stop echo-feed", "offer "]);
  });
});
