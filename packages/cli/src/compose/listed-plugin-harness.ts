import { join } from "node:path";
import { createIdSource, type HttpDownload } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import type { EnginePush } from "@binference/engine";
import { createRunningTurns } from "@binference/engine/chat";
import { ensurePrivateFolder, removePath } from "@binference/platform";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { type JobFailedPush, jobFailedPushSchema } from "@binference/protocol";
import { noPermissions } from "../e2e/test-host.js";
import { createListingSigner } from "../plugins/fake-listing-signer.js";
import type { FakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import { asPayload, listingFixture } from "../plugins/listing-fixtures.js";
import { listingGateOf } from "../plugins/listing-gate.js";
import { createNpmRegistry } from "../plugins/npm-registry.js";
import { createPluginRecords } from "../plugins/plugin-records.js";
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

// A runner that starts nothing: these cases end before any plugin would run.
const idleRunner: PluginRunner = {
  begin: async () => Promise.resolve(false),
  run: async () => Promise.resolve(),
  stop: async () => Promise.resolve(),
  call: async () => Promise.resolve({ ok: false, error: "unknown_plugin" }),
  offer: async () => Promise.resolve(),
};

/** Where the Cloud composition's plugin operations run for a test. */
export interface ListedPluginPlace {
  readonly registry: FakeNpmRegistry;
  readonly http: HttpDownload;
  readonly folder: string;
}

/** The Cloud composition's plugin operations, and how a test adds a plugin through them. */
export interface CloudPluginOperations {
  readonly root: CloudTestRoot;
  /** Starts `plugin/add` and answers the error its job ended with. */
  add(args: { readonly source: string; readonly hash: string }): Promise<JobFailedPush["error"]>;
}

/** The plugin operations as the Cloud composition wires them: the Cloud test root's listing rule. */
export function cloudPluginOperations(place: ListedPluginPlace): CloudPluginOperations {
  const clock = createManualClock(startMs);
  const root = composeCloudTestRoot({ clock });
  const logger = createMemoryLogger({ subsystem: "plugins" });
  const random = createSeededRandom(3);
  const ids = createIdSource({ clock, random });
  const ends: ((push: EnginePush) => void)[] = [];
  const listing = listingGateOf(root.pluginListing, { clock, logger });
  const { folder } = place;
  const handlers = createPluginOperations({
    registry: createNpmRegistry({ download: place.http, base: place.registry.base }),
    verify: async () => Promise.resolve({ ok: false, error: "unverified" }),
    records: createPluginRecords({ file: join(folder, "lock.json"), permissions: noPermissions }),
    shelf: { packages: join(folder, "packages"), work: join(folder, "work") },
    runner: idleRunner,
    makeData: async (id, signal) =>
      ensurePrivateFolder(join(folder, "data", id), { permissions: noPermissions, signal }),
    removeData: async (id, signal) => removePath(join(folder, "data", id), signal),
    newPlugin: () => ids.next("plg"),
    turns: createRunningTurns(),
    publish: (push) => ends.shift()?.(push),
    closers: createClosers(),
    clock,
    random,
    logger,
    ...(listing === undefined ? {} : { listing }),
  });
  return {
    root,
    add: async (args) => {
      const ended = new Promise<EnginePush>((resolve) => ends.push(resolve));
      await handlers["plugin/add"]?.({ args, caller: owner, signal: new AbortController().signal });
      return jobFailedPushSchema.parse((await ended).data).error;
    },
  };
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
