import { join } from "node:path";
import { createManualClock, createMemoryLogger, type ManualClock } from "@binference/core/testing";
import type { PluginNotice } from "@binference/engine/notices";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { createFakePluginCatalog, type FakePluginCatalog } from "./fake-plugin-catalog.js";
import { createListedRunner } from "./listed-runner.js";
import { listedEntryFixture, listingFixture, listingIdFixture } from "./listing-fixtures.js";
import { createListingGate, type ListingGate } from "./listing-gate.js";
import { createListingKeys } from "./listing-keys.js";
import { createListingWatch, type ListingWatch } from "./listing-watch.js";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";
import { createPluginRecords, type PluginRecords } from "./plugin-records.js";
import type { PluginRunner } from "./plugin-runner.js";

let folder: TempFolder;

beforeAll(async () => {
  folder = await createTempFolder("listing-watch-");
});

afterAll(async () => {
  await folder.remove();
});

const startMs = 1_767_261_600_000;
const signal = new AbortController().signal;
const listing = listingFixture();

interface Watched {
  readonly clock: ManualClock;
  readonly catalog: FakePluginCatalog;
  readonly gate: ListingGate;
  readonly records: PluginRecords;
  readonly watch: ListingWatch;
  readonly asked: string[];
  readonly told: PluginNotice[];
  /** Resolves once the runner is asked `line`. */
  asking(line: string): Promise<void>;
  /** One entry per change of the lock since the start. */
  readonly changes: string[];
}

// The plugins the runner is asked to start or offer, as names.
const names = (lock: PluginLock): string =>
  lock.plugins
    .filter(({ enabled }) => enabled)
    .map(({ id }) => id)
    .join(",");

// A runner that records each thing it is asked, and wakes the test's wait for one.
function recording(asked: string[], waits: Map<string, () => void>): PluginRunner {
  const ask = (line: string): void => {
    asked.push(line);
    waits.get(line)?.();
  };
  return {
    begin: async (lock) => {
      ask(`begin ${names(lock)}`);
      return Promise.resolve(true);
    },
    run: async (entry) => {
      ask(`run ${entry.id}`);
      return Promise.resolve();
    },
    stop: async (id) => {
      ask(`stop ${id}`);
      return Promise.resolve();
    },
    call: async () => Promise.resolve({ ok: false, error: "unknown_plugin" }),
    offer: async (lock) => {
      ask(`offer ${names(lock)}`);
      return Promise.resolve();
    },
  };
}

// A watch over a lock in `name`, its catalog, and a runner that records what it is asked.
function watched(
  name: string,
  over: { readonly clock?: ManualClock; readonly catalog?: FakePluginCatalog } = {},
): Watched {
  const clock = over.clock ?? createManualClock(startMs);
  const catalog = over.catalog ?? createFakePluginCatalog({ clock });
  const keys = createListingKeys([catalog.signer.spki]);
  const logger = createMemoryLogger({ subsystem: "plugins" });
  const gate = createListingGate({ rule: { kind: "required", keys, catalog }, clock, logger });
  const inner = createPluginRecords({
    file: join(folder.path, `${name}.json`),
    permissions: noPermissions,
    form: "required",
  });
  const changes: string[] = [];
  const records: PluginRecords = {
    read: async (readSignal) => inner.read(readSignal),
    change: async (change, changeSignal) => {
      changes.push("change");
      return inner.change(change, changeSignal);
    },
  };
  const asked: string[] = [];
  const life = new AbortController().signal;
  const waits = new Map<string, () => void>();
  const runner = createListedRunner({ runner: recording(asked, waits), gate, logger, life });
  const asking = async (line: string) =>
    new Promise<void>((resolve) => {
      waits.set(line, resolve);
    });
  const told: PluginNotice[] = [];
  const watch = createListingWatch({
    gate,
    records,
    runner,
    clock,
    logger,
    tell: (notice) => told.push(notice),
    life,
  });
  return { clock, catalog, gate, records, watch, asked, told, changes, asking };
}

// Starts the watched engine on a lock holding `entries`, as the composition root starts it.
async function started(w: Watched, entries: readonly LockedPlugin[]): Promise<void> {
  await w.records.change(() => ({ plugins: entries }), signal);
  const lock = await w.records.read(signal);
  w.watch.restore(lock);
  w.changes.splice(0);
}

describe("the revocation list at work", () => {
  it("turns a running plugin off as revoked with the floor in one change, and tells the owner once", async () => {
    const w = watched("running");
    w.catalog.list(listing);
    await started(w, [listedEntryFixture()]);
    w.catalog.revoke(listing.listing);

    await w.watch.check(signal);
    const lock = await w.records.read(signal);
    await w.watch.check(signal);

    expect(lock.plugins).toMatchObject([{ enabled: false, listing: { revoked: true } }]);
    expect(lock.plugins[0]?.disabledReason).toBeUndefined();
    expect(lock.revocations).toMatchObject({ sequence: 2, key: w.catalog.signer.id });
    expect(w.changes).toHaveLength(1);
    expect(w.asked).toStrictEqual(["stop echo-feed", "offer "]);
    expect(w.told).toStrictEqual([{ kind: "revoked", plugin: "echo-feed", version: "1.0.0" }]);
  });

  it("marks a plugin the owner had off revoked too, keeping the owner's reason", async () => {
    const w = watched("off");
    w.catalog.list(listing);
    await started(w, [listedEntryFixture({ enabled: false, disabledReason: "owner" })]);
    w.catalog.revoke(listing.listing);

    await w.watch.check(signal);

    await expect(w.records.read(signal)).resolves.toMatchObject({
      plugins: [{ enabled: false, disabledReason: "owner", listing: { revoked: true } }],
    });
    expect(w.told).toHaveLength(1);
  });

  it("marks only what the lock holds at its change, so an update since its read keeps its listing", async () => {
    const w = watched("updated");
    const update = { ...listing, listing: listingIdFixture(2), packageVersion: "1.1.0" };
    w.catalog.list(listing);
    w.catalog.list(update);
    const before = listedEntryFixture();
    const after = listedEntryFixture({
      version: "1.1.0",
      listing: { listing: update.listing, version: 1 },
    });
    await started(w, [after]);
    const stale: PluginRecords = {
      read: async () => Promise.resolve({ plugins: [before] }),
      change: async (change, changeSignal) => w.records.change(change, changeSignal),
    };
    const logger = createMemoryLogger({ subsystem: "plugins" });
    const life = new AbortController().signal;
    const watch = createListingWatch({
      gate: w.gate,
      records: stale,
      runner: createListedRunner({ runner: recording([], new Map()), gate: w.gate, logger, life }),
      clock: w.clock,
      logger,
      tell: () => undefined,
      life,
    });
    w.catalog.revoke(listing.listing);

    await watch.check(signal);

    await expect(w.records.read(signal)).resolves.toMatchObject({
      plugins: [{ version: "1.1.0", enabled: true, listing: { listing: update.listing } }],
    });
    expect((await w.records.read(signal)).plugins[0]?.listing?.revoked).toBeUndefined();
  });

  it("takes no older list after a restart, from the floor the lock kept", async () => {
    const first = watched("restart");
    first.catalog.list(listing);
    await started(first, [listedEntryFixture({ enabled: false, disabledReason: "owner" })]);
    first.catalog.renew();
    await first.watch.check(signal);
    const [older] = first.catalog.signedLists();
    const again = watched("restart", { clock: first.clock, catalog: first.catalog });
    again.watch.restore(await again.records.read(signal));
    first.catalog.serveRevocations(String(older));

    const source = {
      name: listing.packageName,
      version: listing.packageVersion,
      integrity: listing.integrity,
    };

    await expect(again.gate.refresh(signal)).resolves.toStrictEqual({
      ok: false,
      error: "bad_answer",
    });
    await expect(again.gate.forPackage(source, signal)).resolves.toMatchObject({
      failure: { code: "plugin.listings_unreachable" },
    });
  });

  it("holds every listed plugin once the list expires, telling the owner at most once a day", async () => {
    const w = watched("stale");
    w.catalog.list(listing);
    await started(w, [listedEntryFixture()]);
    await w.watch.check(signal);
    w.catalog.goDown("refuse");
    await w.clock.advance(3_600_000);
    await w.watch.check(signal);
    await w.watch.check(signal);
    w.catalog.comeBack();
    w.catalog.renew();
    await w.watch.check(signal);
    w.catalog.goDown("refuse");
    await w.clock.advance(3_600_000);
    await w.watch.check(signal);
    const toldWithinADay = [...w.told];
    w.catalog.comeBack();
    w.catalog.renew();
    await w.watch.check(signal);
    w.catalog.goDown("refuse");
    await w.clock.advance(86_400_000);
    await w.watch.check(signal);

    expect(toldWithinADay).toStrictEqual([{ kind: "held" }]);
    expect(w.told).toStrictEqual([{ kind: "held" }, { kind: "held" }]);
    expect(w.asked.slice(0, 3)).toStrictEqual(["stop echo-feed", "offer ", "run echo-feed"]);
    await expect(w.records.read(signal)).resolves.toMatchObject({ plugins: [{ enabled: true }] });
  });

  it("stops a revoked plugin at the next read, 60 seconds after the last", async () => {
    const w = watched("bound");
    w.catalog.list(listing);
    await started(w, [listedEntryFixture()]);
    await w.watch.check(signal);
    w.watch.run();
    await w.clock.advance(1);
    w.catalog.revoke(listing.listing);
    await w.clock.advance(59_998);
    const beforeTheRead = [...w.asked];
    const stopped = w.asking("stop echo-feed");
    await w.clock.advance(1);
    await stopped;

    expect(beforeTheRead).toStrictEqual([]);
    expect(w.clock.now()).toBe(startMs + 60_000);
  });
});
