import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyArgsSchema, emptyResultSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type Page, pageSchema } from "../values/page.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import { type JobRef, jobRefSchema } from "../views/job-ref.schema.js";
import { localWriteFlags, readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** A model role: `main` talks and proposes, `fast` summarizes, `vision` reads images. */
type ModelRole = "main" | "fast" | "vision";

/** A model's prices per million tokens, in micro-dollars. */
interface ModelPrices {
  readonly inputPerMTokUsdMicros: bigint;
  readonly outputPerMTokUsdMicros: bigint;
  readonly cachedPerMTokUsdMicros: bigint;
}

/** The model a role uses, `<provider>/<model>`, with its prices when known. */
interface ModelView {
  readonly role: ModelRole;
  readonly model: string;
  readonly prices?: ModelPrices;
}

/** The args of `model/set` (`/ai`). */
interface SetModelArgs {
  readonly agent: ProtocolId<"agent">;
  readonly role: ModelRole;
  readonly model: string;
}

/** An installed plugin: its tier, the permissions it declares, and whether it runs. */
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
}

/** The args of `plugin/add` and `skill/add`: where to install from and the expected hash. */
interface InstallArgs {
  readonly source: string;
  readonly hash: string;
}

/** An installed skill. */
interface SkillView {
  readonly skill: string;
  readonly agent?: ProtocolId<"agent">;
  readonly name: string;
  readonly source: string;
  readonly hash: string;
  readonly installedAt: number;
}

/** The args of an operation on one plugin. */
interface PluginArgs {
  readonly plugin: ProtocolId<"installedPlugin">;
}

/** The model, plugin and skill operations of protocol spec section 7.8. */
export interface PluginOperationShapes {
  readonly "model/list": { readonly args: Empty; readonly result: Page<ModelView> };
  readonly "model/set": { readonly args: SetModelArgs; readonly result: Page<ModelView> };
  readonly "plugin/list": { readonly args: Empty; readonly result: Page<PluginView> };
  readonly "plugin/add": { readonly args: InstallArgs; readonly result: JobRef };
  readonly "plugin/enable": { readonly args: PluginArgs; readonly result: PluginView };
  readonly "plugin/disable": { readonly args: PluginArgs; readonly result: PluginView };
  readonly "plugin/remove": { readonly args: PluginArgs; readonly result: Empty };
  readonly "skill/list": {
    readonly args: { readonly agent?: ProtocolId<"agent"> };
    readonly result: Page<SkillView>;
  };
  readonly "skill/add": { readonly args: InstallArgs; readonly result: JobRef };
  readonly "skill/remove": { readonly args: { readonly skill: string }; readonly result: Empty };
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
});
const pluginArgs = z.strictObject({ plugin: protocolIdSchema("installedPlugin") });
const installArgs = z.strictObject({
  source: z.string().min(1).max(2048),
  hash: z.string().min(1).max(256),
});

/** The model, plugin and skill operations, by name. */
export const pluginOperations: OperationTable<PluginOperationShapes> = {
  "model/list": {
    ...readFlags,
    name: "model/list",
    scope: "read",
    args: emptyArgsSchema,
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
    args: installArgs,
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
      }),
    ),
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
};
