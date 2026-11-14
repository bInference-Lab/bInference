import { join } from "node:path";
import { createIdSource, type Clock, type Logger } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import type { RunningTurns } from "@binference/engine/chat";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { ensurePrivateFolder } from "@binference/platform";
import { createTempFolder } from "@binference/platform/testing";
import { type CommunityManifest, communityManifestSchema } from "@binference/plugin-sdk/community";
import { createClosers } from "../compose/closers.js";
import { createPluginOperations } from "../compose/plugin-operations.js";
import { noPermissions } from "../e2e/test-host.js";
import { declarationsOf, digestOf } from "../plugins/plugin-declarations.js";
import { type LockedPlugin, writePluginLock } from "../plugins/plugin-lock.js";
import { createPluginRecords } from "../plugins/plugin-records.js";
import type { PluginRunner } from "../plugins/plugin-runner.js";
import { createSystemRandom } from "../runtime/system-random.js";

// The smoke engine's installed plugins: the plugin operations of the self-hosted engine over a
// state folder of the smoke's own, which holds a plugin lock of two plugins, one on and one
// stopped after crashing. Its plugin runner starts nothing, and nothing is fetched.

/** What the smoke's shelves need from the engine. */
export interface SmokeShelfParts {
  readonly clock: Clock;
  readonly turns: RunningTurns;
  readonly publish: PublishPush;
  readonly logger: Logger;
}

const live = () => ({ permissions: noPermissions, signal: AbortSignal.timeout(10_000) });

// A manifest as a package declares it, read by the schema every install reads it with.
function manifestOf(id: string, hosts: readonly string[], config?: object): CommunityManifest {
  const tool = {
    name: id.replaceAll("-", "_"),
    description: `Reads ${id}.`,
    input: { type: "object", properties: {}, additionalProperties: false },
    output: { type: "object" },
  };
  const manifest = { api: 1, id, kinds: ["data"], entry: "index.mjs", hosts, tools: [tool] };
  return communityManifestSchema.parse(config === undefined ? manifest : { ...manifest, config });
}

function lockedOf(plugin: string, manifest: CommunityManifest, extra: object): LockedPlugin {
  return {
    plugin,
    id: manifest.id,
    packageName: manifest.id,
    version: "1.2.0",
    source: `npm:${manifest.id}@1.2.0`,
    integrity: `sha512-${"A".repeat(86)}==`,
    hash: "a".repeat(64),
    manifest,
    accepted: digestOf(declarationsOf(manifest)),
    provenance: "none",
    enabled: true,
    installedAt: Date.UTC(2026, 10, 3, 9, 30),
    ...extra,
  };
}

// The two plugins of the smoke's lock.
const lockedPlugins: readonly LockedPlugin[] = [
  lockedOf(
    "plg_0190f1c2-3a4b-7c5d-8e6f-0000000000a1",
    manifestOf("fear-index", ["api.alternative.me"], {
      type: "object",
      properties: { window: { type: "integer" } },
      additionalProperties: false,
    }),
    { provenance: "verified", publisher: "github.com/owner/fear-index" },
  ),
  lockedOf(
    "plg_0190f1c2-3a4b-7c5d-8e6f-0000000000a2",
    manifestOf("whale-feed", ["api.whales.example", "ws.whales.example"]),
    { enabled: false, disabledReason: "crashes", publisher: "whaler" },
  ),
];

// A runner that starts no plugin process: the smoke shows the lock, never runs a plugin.
const stillRunner: PluginRunner = {
  begin: async () => Promise.resolve(false),
  run: async () => Promise.resolve(),
  stop: async () => Promise.resolve(),
  call: async () => Promise.resolve({ ok: false, error: "unknown_plugin" }),
  offer: async () => Promise.resolve(),
};

async function pluginHandlers(folder: string, parts: SmokeShelfParts) {
  const file = join(folder, "lock.json");
  await ensurePrivateFolder(folder, live());
  await writePluginLock(file, { plugins: lockedPlugins }, live());
  const random = createSystemRandom();
  const ids = createIdSource({ clock: parts.clock, random });
  return createPluginOperations({
    registry: {
      version: async () => Promise.resolve({ ok: false, failure: { reason: "not_published" } }),
      tarball: async () => Promise.resolve({ ok: false, failure: { reason: "not_published" } }),
      attestations: async () =>
        Promise.resolve({ ok: false, failure: { reason: "not_published" } }),
    },
    verify: async () => Promise.resolve({ ok: false, error: "unverified" }),
    records: createPluginRecords({ file, permissions: noPermissions }),
    shelf: { packages: join(folder, "packages"), work: join(folder, "work") },
    runner: stillRunner,
    makeData: async () => Promise.resolve(),
    removeData: async () => Promise.resolve(),
    newPlugin: () => ids.next("plg"),
    ...parts,
    random,
    closers: createClosers(),
  });
}

/** The smoke's plugin handlers, and how to remove their state folder. */
export interface SmokeShelves {
  readonly handlers: EngineHandlerTable;
  close(): Promise<void>;
}

/** Makes the smoke's state folder and the plugin operations over it. */
export async function startSmokeShelves(parts: SmokeShelfParts): Promise<SmokeShelves> {
  const folder = await createTempFolder("bnf-smoke-shelves-");
  const state = join(folder.path, "state");
  const handlers = await pluginHandlers(join(state, "plugins"), parts);
  return { handlers, close: async () => folder.remove() };
}
