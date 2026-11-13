import { join } from "node:path";
import { createIdSource, type HttpDownload } from "@binference/core";
import { createSeededRandom, type ManualClock } from "@binference/core/testing";
import { ensurePrivateFolder, readTextFile } from "@binference/platform";
import { noPermissions } from "../e2e/test-host.js";
import type { InstallParts } from "./install-plugin.js";
import type { ListingGate } from "./listing-gate.js";
import { createNpmRegistry } from "./npm-registry.js";
import { createPluginRecords } from "./plugin-records.js";

/** An install's parts over a test's registry and folder, with no plugin host. */
export interface InstallHarness {
  readonly parts: InstallParts;
  /** The plugin lock's text as the install wrote it, or none before the first write. */
  lockText(signal: AbortSignal): Promise<string | undefined>;
}

/**
 * The parts `installPlugin` runs on, for a test: the npm registry at `registryBase`, the plugin
 * lock and shelf in `folder`, ids from a seeded source, and a runner that runs nothing, so a test
 * reads what an install decides and writes without starting a plugin.
 */
export function createInstallHarness(options: {
  readonly registryBase: string;
  readonly http: HttpDownload;
  readonly folder: string;
  readonly clock: ManualClock;
  /** The listing rule's checks, where the test's composition needs listings. */
  readonly listing?: ListingGate;
}): InstallHarness {
  const { folder, clock } = options;
  const random = createSeededRandom(7);
  const ids = createIdSource({ clock, random });
  const file = join(folder, "lock.json");
  const parts: InstallParts = {
    registry: createNpmRegistry({ download: options.http, base: options.registryBase }),
    verify: async () => Promise.resolve({ ok: false, error: "unverified" }),
    records: createPluginRecords({
      file,
      permissions: noPermissions,
      form: options.listing === undefined ? "notRequired" : "required",
    }),
    shelf: { packages: join(folder, "packages"), work: join(folder, "work") },
    runner: {
      begin: async () => Promise.resolve(false),
      run: async () => Promise.resolve(),
      stop: async () => Promise.resolve(),
      offer: async () => Promise.resolve(),
    },
    makeData: async (id, signal) =>
      ensurePrivateFolder(join(folder, "data", id), { permissions: noPermissions, signal }),
    newPlugin: () => ids.next("plg"),
    clock,
    random,
    ...(options.listing === undefined ? {} : { listing: options.listing }),
  };
  return {
    parts,
    lockText: async (signal) => {
      const read = await readTextFile(file, signal);
      return read.ok ? read.value : undefined;
    },
  };
}
