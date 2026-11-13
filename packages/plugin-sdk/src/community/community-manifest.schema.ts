import { isSmallJsonSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { communityPluginLimits as limits } from "@binference/protocol";
import { z } from "zod";

/** What a community plugin may be: it reads data or adds skills, never more (decision 0300). */
export type CommunityKind = "data" | "skills";

/** A JSON Schema object, as a manifest writes a tool's input, output or config. */
export type JsonSchemaObject = Readonly<Record<string, JsonValue>>;

/** One tool a community plugin adds: a read the agent may call. */
export interface CommunityToolDeclaration {
  /** The tool's name: 1 to 64 of `[a-z0-9_]`, starting with a letter. */
  readonly name: string;
  /** What the model reads to decide when to call it: 1 to 1,000 characters. */
  readonly description: string;
  /** The JSON Schema of its input: an object whose every object names its fields alone. */
  readonly input: JsonSchemaObject;
  /** The JSON Schema its answers must meet, or the host refuses them. */
  readonly output: JsonSchemaObject;
}

/**
 * The `binference` field of a community plugin's `package.json` (ARCHITECTURE.md section 14): its
 * id, the API version it speaks, its kinds, the file the plugin host loads, the hosts it may
 * fetch, its tools and its config schema. A community plugin declares no contract, no call and no
 * transaction cap: the schema is strict, so such a field, `maxValueBase` among them, is refused.
 * Its tool and config schemas use a short list of JSON Schema keywords, with no regex of the
 * plugin's own, at most 8 levels deep and 16,384 characters long (decision 0343). It declares
 * no more than `communityPluginLimits` lets a permission review show whole: 16 hosts of up to
 * 100 characters, 32 tools and 64 config keys of up to 64 characters (decision 0348).
 */
export interface CommunityManifest {
  readonly api: 1;
  /** Its id: 2 to 40 of `[a-z0-9-]`, starting with a letter. */
  readonly id: string;
  readonly kinds: readonly CommunityKind[];
  /** The module the host loads, relative to the package's folder, such as `dist/index.mjs`. */
  readonly entry: string;
  /** The host names it may fetch over HTTPS, lowercase, at most 16. */
  readonly hosts: readonly string[];
  readonly tools: readonly CommunityToolDeclaration[];
  /** The JSON Schema of its settings, `plugins.<id>` in `config.json5`. */
  readonly config?: JsonSchemaObject;
}

const idPattern = /^[a-z][a-z0-9-]{1,39}$/;
const toolNamePattern = /^[a-z][a-z0-9_]{0,63}$/;
// A DNS name of letters, digits and hyphens with a dot, never an address or a wildcard.
const hostPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// A relative path inside the package: no leading slash, no backslash, no `.` or `..` part.
const entryPattern = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[\w@.-]+(?:\/[\w@.-]+)*\.m?js$/;

// An object whose fields a JSON Schema names must say `additionalProperties: false`, so a tool's
// input is checked as written.
function namesEveryField(node: JsonValue): boolean {
  if (typeof node !== "object" || node === null) {
    return true;
  }
  const fields = new Map<string, JsonValue>(Object.entries(node));
  if (fields.has("properties") && fields.get("additionalProperties") !== false) {
    return false;
  }
  return [...fields.values()].every(namesEveryField);
}

const jsonSchemaObjectSchema: z.ZodType<JsonSchemaObject> = z
  .record(z.string(), jsonValueSchema)
  .refine(
    (schema) => isSmallJsonSchema(schema),
    "must be a small JSON Schema of the allowed keywords, with no regex",
  );

const toolSchema: z.ZodType<CommunityToolDeclaration> = z.strictObject({
  name: z.string().regex(toolNamePattern),
  description: z.string().min(1).max(1_000),
  input: jsonSchemaObjectSchema
    .refine((schema) => schema["type"] === "object", "must describe an object")
    .refine(namesEveryField, "every object must set additionalProperties: false"),
  output: jsonSchemaObjectSchema,
});

function distinct(names: readonly string[]): boolean {
  return new Set(names).size === names.length;
}

// The top-level keys of a config schema, as the review lists them, fit it whole.
function configKeysFit(config: JsonSchemaObject): boolean {
  const properties = config["properties"];
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return true;
  }
  const keys = Object.keys(properties);
  return (
    keys.length <= limits.configKeys && keys.every((key) => key.length <= limits.configKeyLength)
  );
}

/** The schema of {@link CommunityManifest}: strict at every level. */
export const communityManifestSchema: z.ZodType<CommunityManifest> = z.strictObject({
  api: z.literal(1),
  id: z.string().regex(idPattern),
  kinds: z
    .array(z.enum(["data", "skills"]))
    .min(1)
    .refine(distinct, "kinds repeat"),
  entry: z.string().max(200).regex(entryPattern),
  hosts: z
    .array(z.string().max(limits.hostLength).regex(hostPattern))
    .max(limits.hosts)
    .refine(distinct, "hosts repeat"),
  tools: z
    .array(toolSchema)
    .max(limits.tools)
    .refine((tools) => distinct(tools.map(({ name }) => name)), "tool names repeat"),
  config: jsonSchemaObjectSchema
    .refine(
      configKeysFit,
      `holds at most ${String(limits.configKeys)} keys of ${String(limits.configKeyLength)} characters`,
    )
    .exactOptional(),
});
