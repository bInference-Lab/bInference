import { decimalStringSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyArgsSchema, emptyResultSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type Page, pageSchema } from "../values/page.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import { type JobRef, jobRefSchema } from "../views/job-ref.schema.js";
import { type PluginListingView, pluginListingViewSchema } from "../views/plugin-listing.schema.js";
import type { PluginProvenance } from "../views/plugin-review.schema.js";
import { localWriteFlags, readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** A model role: `main` talks and proposes, `fast` summarizes, `vision` reads images. */
type ModelRole = "main" | "fast" | "vision";

/** A model's prices per million tokens, in micro-dollars. */
interface ModelPrices {
  readonly inputPerMTokUsdMicros: bigint;
  readonly outputPerMTokUsdMicros: bigint;
  readonly cachedPerMTokUsdMicros: bigint;
}

/**
 * A configured model of a role, `<provider>/<model>`, with its prices when known. For one agent,
 * `current` marks the model its next turn uses for the role (decision 0204).
 */
interface ModelView {
  readonly role: ModelRole;
  readonly model: string;
  readonly prices?: ModelPrices;
  readonly current?: boolean;
}

/** The args of `model/list`: every configured model, and for one agent which one it uses. */
interface ModelListArgs {
  readonly agent?: ProtocolId<"agent">;
}

/** The args of `model/set` (`/ai`). */
interface SetModelArgs {
  readonly agent: ProtocolId<"agent">;
  readonly role: ModelRole;
  readonly model: string;
}

/** Why an installed plugin is off: the owner turned it off, it crashed, or its files changed. */
type PluginOffReason = "owner" | "crashes" | "changed";

/**
 * An installed plugin: its tier, the permissions it declares (`kind:`, `host:`, `tool:` and
 * `config:` each followed by its name), and whether it runs. A community plugin also names its
 * provenance and publisher (decision 0348), why it is off, and the tools the agent sees.
 */
interface PluginView {
  readonly plugin: ProtocolId<"installedPlugin">;
  readonly name: string;
  readonly version: string;
  readonly tier: "core" | "verified" | "community";
  readonly source: string;
  readonly hash: string;
  readonly permissions: readonly string[];
  readonly state: "enabled" | "disabled";
  readonly installedAt: number;
  readonly provenance?: PluginProvenance;
  readonly publisher?: string;
  readonly disabledReason?: PluginOffReason;
  /** Each tool by the name the agent calls it, `<id>__<tool>`. */
  readonly tools?: readonly string[];
  /** Its listing and where it stands with it, where the engine needs one. */
  readonly listing?: PluginListingView;
}

/** The args of `skill/add`: where to install from and the expected hash. */
interface InstallArgs {
  readonly source: string;
  readonly hash: string;
}

/**
 * The args of `plugin/add` (decision 0348): the source, `npm:<name>@<version>`; the version's
 * npm integrity, `sha512-` and its base64 digest; the review's `digest` the owner accepts; and,
 * for a plugin without npm provenance, its id as the owner typed it.
 */
interface PluginAddArgs {
  readonly source: string;
  readonly hash: string;
  readonly accepted?: string;
  readonly typedName?: string;
}

/** The args of `plugin/call`: one tool of an enabled community plugin, called for an agent. */
interface PluginCallArgs {
  readonly agent: ProtocolId<"agent">;
  readonly plugin: ProtocolId<"installedPlugin">;
  /** The tool's name in the plugin's manifest. */
  readonly tool: string;
  readonly input: JsonValue;
}

/** Where a skill lives: shipped with binference, installed for every agent, or one agent's own. */
type SkillPlace = "bundled" | "installed" | "workspace";

/**
 * A skill (decision 0207): its id, its name, where it came from and its pinned hash, and for one
 * agent's list the description and location its index shows.
 */
interface SkillView {
  readonly skill: string;
  readonly agent?: ProtocolId<"agent">;
  readonly name: string;
  readonly source: string;
  readonly hash: string;
  readonly installedAt: number;
  readonly description?: string;
  readonly place?: SkillPlace;
  /** `<place>/<name>/SKILL.md`: what the agent's index names the skill by. */
  readonly location?: string;
  /**
   * A workspace skill whose files the owner has not accepted as they are (decision 0408): it does
   * not load, and `hash` is the folder hash `skill/accept` takes.
   */
  readonly held?: boolean;
}

/** The args of `skill/read`: one file of a skill the agent's index holds. */
interface ReadSkillArgs {
  readonly agent: ProtocolId<"agent">;
  /** The skill's name. */
  readonly skill: string;
  /** A path inside the skill's folder; `SKILL.md` when absent. */
  readonly file?: string;
}

/** One file of a skill, as `skill/read` answers it. */
interface SkillText {
  readonly skill: string;
  readonly place: SkillPlace;
  readonly location: string;
  readonly file: string;
  readonly text: string;
}

/** The args of `skill/accept`: a waiting workspace skill, by the folder hash the owner saw. */
interface AcceptSkillArgs {
  readonly agent: ProtocolId<"agent">;
  readonly skill: string;
  readonly hash: string;
}

/** The args of an operation on one plugin. */
interface PluginArgs {
  readonly plugin: ProtocolId<"installedPlugin">;
}

/** The model, plugin and skill operations of protocol spec section 7.8. */
export interface PluginOperationShapes {
  readonly "model/list": { readonly args: ModelListArgs; readonly result: Page<ModelView> };
  readonly "model/set": { readonly args: SetModelArgs; readonly result: Page<ModelView> };
  readonly "plugin/list": { readonly args: Empty; readonly result: Page<PluginView> };
  readonly "plugin/add": { readonly args: PluginAddArgs; readonly result: JobRef };
  readonly "plugin/enable": { readonly args: PluginArgs; readonly result: PluginView };
  readonly "plugin/disable": { readonly args: PluginArgs; readonly result: PluginView };
  readonly "plugin/remove": { readonly args: PluginArgs; readonly result: Empty };
  readonly "plugin/call": {
    readonly args: PluginCallArgs;
    readonly result: { readonly output: JsonValue };
  };
  readonly "skill/list": {
    readonly args: { readonly agent?: ProtocolId<"agent"> };
    readonly result: Page<SkillView>;
  };
  readonly "skill/read": { readonly args: ReadSkillArgs; readonly result: SkillText };
  readonly "skill/add": { readonly args: InstallArgs; readonly result: JobRef };
  readonly "skill/remove": { readonly args: { readonly skill: string }; readonly result: Empty };
  readonly "skill/accept": { readonly args: AcceptSkillArgs; readonly result: Empty };
}

const role = z.enum(["main", "fast", "vision"]);
const modelRef = z.string().regex(/^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const models = pageSchema(
  z.object({
    role,
    model: modelRef,
    prices: z
      .object({
        inputPerMTokUsdMicros: decimalStringSchema,
        outputPerMTokUsdMicros: decimalStringSchema,
        cachedPerMTokUsdMicros: decimalStringSchema,
      })
      .exactOptional(),
    current: z.boolean().exactOptional(),
  }),
);
const pluginView = z.object({
  plugin: protocolIdSchema("installedPlugin"),
  name: z.string(),
  version: z.string(),
  tier: z.enum(["core", "verified", "community"]),
  source: z.string(),
  hash: z.string(),
  permissions: z.array(z.string()),
  state: z.enum(["enabled", "disabled"]),
  installedAt: epochMsSchema,
  provenance: z.enum(["verified", "none"]).exactOptional(),
  publisher: z.string().exactOptional(),
  disabledReason: z.enum(["owner", "crashes", "changed"]).exactOptional(),
  tools: z.array(z.string()).exactOptional(),
  listing: pluginListingViewSchema.exactOptional(),
});
const pluginArgs = z.strictObject({ plugin: protocolIdSchema("installedPlugin") });
const skillPlace = z.enum(["bundled", "installed", "workspace"]);
// A skill's name in the Agent Skills format: lowercase letters, digits and single hyphens.
const skillName = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
// A path inside a skill's folder; the engine checks each of its parts.
const skillFile = z.string().min(1).max(256);
const installArgs = z.strictObject({
  source: z.string().min(1).max(2048),
  hash: z.string().min(1).max(256),
});
const pluginAddArgs = z.strictObject({
  source: z.string().min(1).max(2048),
  hash: z.string().min(1).max(256),
  accepted: z.string().min(1).max(256).exactOptional(),
  typedName: z.string().min(1).max(64).exactOptional(),
});

/** The model, plugin and skill operations, by name. */
export const pluginOperations: OperationTable<PluginOperationShapes> = {
  "model/list": {
    ...readFlags,
    name: "model/list",
    scope: "read",
    args: z.strictObject({ agent: protocolIdSchema("agent").exactOptional() }),
    result: models,
  },
  "model/set": {
    ...writeFlags,
    name: "model/set",
    scope: "confirm",
    args: z.strictObject({ agent: protocolIdSchema("agent"), role, model: modelRef }),
    result: models,
  },
  "plugin/list": {
    ...readFlags,
    name: "plugin/list",
    scope: "read",
    args: emptyArgsSchema,
    result: pageSchema(pluginView),
  },
  "plugin/add": {
    ...localWriteFlags,
    name: "plugin/add",
    scope: "admin",
    args: pluginAddArgs,
    result: jobRefSchema,
  },
  "plugin/enable": {
    ...writeFlags,
    name: "plugin/enable",
    scope: "admin",
    args: pluginArgs,
    result: pluginView,
  },
  "plugin/disable": {
    ...writeFlags,
    name: "plugin/disable",
    scope: "confirm",
    args: pluginArgs,
    result: pluginView,
  },
  "plugin/remove": {
    ...writeFlags,
    name: "plugin/remove",
    scope: "admin",
    args: pluginArgs,
    result: emptyResultSchema,
  },
  "plugin/call": {
    ...readFlags,
    name: "plugin/call",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      plugin: protocolIdSchema("installedPlugin"),
      tool: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      input: jsonValueSchema,
    }),
    result: z.object({ output: jsonValueSchema }),
  },
  "skill/list": {
    ...readFlags,
    name: "skill/list",
    scope: "read",
    args: z.strictObject({ agent: protocolIdSchema("agent").exactOptional() }),
    result: pageSchema(
      z.object({
        skill: plainIdSchema,
        agent: protocolIdSchema("agent").exactOptional(),
        name: z.string(),
        source: z.string(),
        hash: z.string(),
        installedAt: epochMsSchema,
        description: z.string().exactOptional(),
        place: skillPlace.exactOptional(),
        location: z.string().exactOptional(),
        held: z.boolean().exactOptional(),
      }),
    ),
  },
  "skill/read": {
    ...readFlags,
    name: "skill/read",
    scope: "read",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      skill: skillName,
      file: skillFile.exactOptional(),
    }),
    result: z.object({
      skill: z.string(),
      place: skillPlace,
      location: z.string(),
      file: z.string(),
      text: z.string(),
    }),
  },
  "skill/add": {
    ...localWriteFlags,
    name: "skill/add",
    scope: "admin",
    args: installArgs,
    result: jobRefSchema,
  },
  "skill/remove": {
    ...writeFlags,
    name: "skill/remove",
    scope: "admin",
    args: z.strictObject({ skill: plainIdSchema }),
    result: emptyResultSchema,
  },
  "skill/accept": {
    ...writeFlags,
    name: "skill/accept",
    scope: "confirm",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      skill: skillName,
      hash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
    result: emptyResultSchema,
  },
};
