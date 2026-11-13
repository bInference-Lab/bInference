import { join } from "node:path";
import { createIdSource, type HttpDownload } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
  type ManualClock,
  type MemoryLogger,
} from "@binference/core/testing";
import type { EnginePush } from "@binference/engine";
import { createRunningTurns } from "@binference/engine/chat";
import type { QuotaSource } from "@binference/engine/quotas";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { ensurePrivateFolder, removePath } from "@binference/platform";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { type JobFailedPush, jobFailedPushSchema } from "@binference/protocol";
import { noPermissions } from "../e2e/test-host.js";
import { createListingSigner } from "../plugins/fake-listing-signer.js";
import type { FakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import { createListedRunner, type ListedRunner } from "../plugins/listed-runner.js";
import { asPayload, listingFixture } from "../plugins/listing-fixtures.js";
import { type ListingGate, listingGateOf } from "../plugins/listing-gate.js";
import { createNpmRegistry } from "../plugins/npm-registry.js";
import type { PluginLock } from "../plugins/plugin-lock.js";
import { createPluginRecords, type PluginRecords } from "../plugins/plugin-records.js";
import type { PluginRunner } from "../plugins/plugin-runner.js";
import { createClosers } from "./closers.js";
import { type CloudTestRoot, composeCloudTestRoot } from "./cloud-test-root.js";
import { createPluginOperations } from "./plugin-operations.js";

const startMs = 1_767_261_600_000;
const owner = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "confirm", "admin"],
  transport: "ipc",
} as const;
const manifest: CommunityManifest = {
  api: 1,
  id: "echo-feed",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: ["api.example.com"],
  tools: [],
};

// The plugins a lock has on, as a runner sees them.
const names = (lock: PluginLock): string =>
  lock.plugins
    .filter(({ enabled }) => enabled)
    .map(({ id }) => id)
    .join(",");

// A runner that starts no process, and records each start, run, stop and offer it is asked.
function recordingRunner(asked: string[]): PluginRunner {
  return {
    begin: async (lock) => {
      asked.push(`begin ${names(lock)}`);
      return Promise.resolve(false);
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
}

/** Where the Cloud composition's plugin operations run for a test. */
export interface ListedPluginPlace {
  readonly registry: FakeNpmRegistry;
  readonly http: HttpDownload;
  readonly folder: string;
}

/** The Cloud composition's plugin operations, and how a test adds a plugin through them. */
export interface CloudPluginOperations {
  readonly root: CloudTestRoot;
  readonly clock: ManualClock;
  readonly logger: MemoryLogger;
  /** The listing gate the operations and the runner share. */
  readonly listing: ListingGate;
  readonly handlers: EngineHandlerTable;
  readonly records: PluginRecords;
  /** The runner under the listing rule, over one that starts nothing. */
  readonly runner: ListedRunner;
  /** What the runner under it was asked, in order: `begin`, `run`, `stop` and `offer` lines. */
  readonly asked: readonly string[];
  /** The caller every operation runs as: the owner at a terminal. */
  readonly owner: typeof owner;
  /** Starts `plugin/add` and answers the error its job ended with. */
  add(args: { readonly source: string; readonly hash: string }): Promise<JobFailedPush["error"]>;
}

// The parts the operations stand on: the Cloud root's clock and rule, a listed runner over one
// that starts nothing, and the plugin lock in the test's folder. A restart keeps the root, its
// clock and the lock, and makes every other part again.
function cloudParts(place: ListedPluginPlace, before: CloudPluginOperations | undefined) {
  const clock = before?.clock ?? createManualClock(startMs);
  const root = before?.root ?? composeCloudTestRoot({ clock });
  const logger = createMemoryLogger({ subsystem: "plugins" });
  const records = createPluginRecords({
    file: join(place.folder, "lock.json"),
    permissions: noPermissions,
    form: "required",
  });
  const listing = listingGateOf(root.pluginListing, { clock, logger, records });
  if (listing === undefined) {
    throw new Error("Expected the Cloud test root to require listings.");
  }
  const life = new AbortController().signal;
  const asked: string[] = [];
  const runner = createListedRunner({
    runner: recordingRunner(asked),
    gate: listing,
    logger,
    life,
  });
  return { clock, root, logger, listing, runner, records, asked };
}

/** The plugin operations as the Cloud composition wires them: the Cloud test root's listing rule. */
export function cloudPluginOperations(
  place: ListedPluginPlace,
  extra: {
    readonly quotas?: QuotaSource;
    /** The operations of the engine before a restart, whose root and clock it keeps. */
    readonly restartOf?: CloudPluginOperations;
    /** Removes a plugin's data folder in place of the test folder's own removal. */
    readonly removeData?: (id: string, signal: AbortSignal) => Promise<void>;
  } = {},
): CloudPluginOperations {
  const parts = cloudParts(place, extra.restartOf);
  const { clock, root, logger, listing, runner, records, asked } = parts;
  const random = createSeededRandom(3);
  const ids = createIdSource({ clock, random });
  const ends: ((push: EnginePush) => void)[] = [];
  const { folder } = place;
  const handlers = createPluginOperations({
    registry: createNpmRegistry({ download: place.http, base: place.registry.base }),
    verify: async () => Promise.resolve({ ok: false, error: "unverified" }),
    records,
    shelf: { packages: join(folder, "packages"), work: join(folder, "work") },
    runner,
    isHeld: (id) => runner.isHeld(id),
    makeData: async (id, signal) =>
      ensurePrivateFolder(join(folder, "data", id), { permissions: noPermissions, signal }),
    removeData:
      extra.removeData ?? (async (id, signal) => removePath(join(folder, "data", id), signal)),
    newPlugin: () => ids.next("plg"),
    turns: createRunningTurns(),
    publish: (push) => ends.shift()?.(push),
    closers: createClosers(),
    clock,
    random,
    logger,
    listing,
    ...(extra.quotas === undefined ? {} : { quotas: extra.quotas }),
  });
  const add: CloudPluginOperations["add"] = async (args) => {
    const ended = new Promise<EnginePush>((resolve) => ends.push(resolve));
    await handlers["plugin/add"]?.({ args, caller: owner, signal: new AbortController().signal });
    return jobFailedPushSchema.parse((await ended).data).error;
  };
  return { root, clock, logger, listing, handlers, records, runner, asked, owner, add };
}

/** A version of the test's plugin on the fake registry: its source, integrity and version. */
interface PublishedVersion {
  readonly source: string;
  readonly hash: string;
  readonly version: string;
}

/** Publishes a version of the test's plugin on the fake registry. */
export function publishedVersion(registry: FakeNpmRegistry, version: string): PublishedVersion {
  const hash = registry.publish({ name: "echo-feed", version, files: [], manifest });
  return { source: `npm:echo-feed@${version}`, hash, version };
}

/**
 * The four refusals the Cloud composition gives an add, each on a version of its own: no listing,
 * a hash other than the listing's, a listing another key signed, and a revoked listing.
 */
export async function cloudRefusals(
  place: ListedPluginPlace,
): Promise<
  Readonly<Record<"unlisted" | "otherHash" | "otherKey" | "revoked", JobFailedPush["error"]>>
> {
  // Each case on operations of its own, since one install runs at a time.
  const opsFor = (name: string) =>
    cloudPluginOperations({ ...place, folder: join(place.folder, name) });
  const unlisted = opsFor("unlisted");
  const otherHash = opsFor("other-hash");
  const otherKey = opsFor("other-key");
  const revoked = opsFor("revoked");
  const versions = ["3.0.1", "3.0.2", "3.0.3", "3.0.4"].map((v) =>
    publishedVersion(place.registry, v),
  );
  const [first, second, third, fourth] = versions;
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    throw new Error("Expected four versions.");
  }
  otherHash.root.pluginListing.catalog.list(listingFixture({ packageVersion: second.version }));
  const forged = listingFixture({ packageVersion: third.version, integrity: third.hash });
  const forgedText = createListingSigner().sign("pluginListing", asPayload(forged));
  otherKey.root.pluginListing.catalog.serveListing(forged, forgedText);
  const withdrawn = listingFixture({ packageVersion: fourth.version, integrity: fourth.hash });
  revoked.root.pluginListing.catalog.list(withdrawn);
  revoked.root.pluginListing.catalog.revoke(withdrawn.listing);
  return {
    unlisted: await unlisted.add(first),
    otherHash: await otherHash.add(second),
    otherKey: await otherKey.add(third),
    revoked: await revoked.add(fourth),
  };
}
