import { join } from "node:path";
import { createIdSource, type Clock, type Logger } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import type { RunningTurns } from "@binference/engine/chat";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { createMemoryConfigJournal, testAgent } from "@binference/engine/testing";
import { ensurePrivateFolder } from "@binference/platform";
import { createTempFolder } from "@binference/platform/testing";
import { type CommunityManifest, communityManifestSchema } from "@binference/plugin-sdk/community";
import { createClosers } from "../compose/closers.js";
import { createPluginOperations } from "../compose/plugin-operations.js";
import { createSkillOperations } from "../compose/skill-operations.js";
import { noPermissions } from "../e2e/test-host.js";
import { declarationsOf, digestOf } from "../plugins/plugin-declarations.js";
import { type LockedPlugin, writePluginLock } from "../plugins/plugin-lock.js";
import { createPluginRecords } from "../plugins/plugin-records.js";
import type { PluginRunner } from "../plugins/plugin-runner.js";
import { createSystemRandom } from "../runtime/system-random.js";
import { createProposalStore } from "../skill-review/proposal-store.js";
import { createSkillReviewHandlers } from "../skill-review/skill-review.js";
import { createAcceptedSkills } from "../skills/accepted-skills.js";
import { bundledSkillRoots } from "../skills/bundled-roots.js";
import { writeInstalledSkills } from "../skills/installed-skills.js";
import { skillText, writeFiles } from "../skills/skill-fixtures.js";
import { createSkillShelf } from "../skills/skill-shelf.js";

// The smoke engine's installed plugins and skills: the plugin and skill operations of the
// self-hosted engine over a state folder of the smoke's own, which holds a plugin lock of two
// plugins, one on and one stopped after crashing, a skill installed from npm and one workspace
// skill of the test agent, beside the skills binference ships. Its plugin runner starts nothing,
// and nothing is fetched.

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

// Where the skills are, with a skill installed from npm and a workspace skill of the test agent,
// which the shelf's first read accepts as it finds it.
async function seedSkills(state: string) {
  const workspace = join(state, "workspace");
  const installed = join(state, "skills");
  await writeFiles(installed, {
    "grid-trader/SKILL.md": skillText("grid-trader", { description: "Trades a range." }),
  });
  const record = {
    source: "npm:grid-trader@1.0.0",
    hash: "b".repeat(64),
    installedAt: Date.UTC(2026, 10, 2, 8, 0),
  };
  await writeInstalledSkills(installed, new Map([["grid-trader", record]]), live());
  await writeFiles(join(workspace, testAgent, "skills"), {
    "my-notes/SKILL.md": skillText("my-notes", { description: "Keeps my notes short." }),
  });
  return { workspace, installed, review: join(state, "skill-review") };
}

async function skillHandlers(state: string, parts: SmokeShelfParts) {
  const { workspace, installed, review } = await seedSkills(state);
  const { clock, logger, publish } = parts;
  const random = createSystemRandom();
  const permissions = noPermissions;
  const accepted = createAcceptedSkills({ folder: review, workspace, permissions, clock, logger });
  const folders = { bundled: bundledSkillRoots, installed, workspace };
  const shelf = createSkillShelf({ folders, startedAtMs: clock.now(), logger, accepted });
  const skills = createSkillOperations({
    shelf,
    folders: { installed, staging: join(state, "skill-work") },
    permissions,
    clock,
    random,
    publish,
    closers: createClosers(),
    logger,
    proxy: () => ({ noProxy: [] }),
  });
  const reviewed = createSkillReviewHandlers({
    shelf,
    accepted,
    proposals: createProposalStore({ folder: join(review, "proposals"), permissions }),
    apply: { workspace, review, permissions, random },
    clock,
    ids: createIdSource({ clock, random }),
    agentName: async () => Promise.resolve("main"),
    journal: { journal: createMemoryConfigJournal(), publish },
  });
  return { ...skills, ...reviewed };
}

/** The smoke's plugin and skill handlers, and how to remove their state folder. */
export interface SmokeShelves {
  readonly handlers: EngineHandlerTable;
  close(): Promise<void>;
}

/** Makes the smoke's state folder and the plugin and skill operations over it. */
export async function startSmokeShelves(parts: SmokeShelfParts): Promise<SmokeShelves> {
  const folder = await createTempFolder("bnf-smoke-shelves-");
  const state = join(folder.path, "state");
  const handlers = {
    ...(await pluginHandlers(join(state, "plugins"), parts)),
    ...(await skillHandlers(state, parts)),
  };
  return { handlers, close: async () => folder.remove() };
}
