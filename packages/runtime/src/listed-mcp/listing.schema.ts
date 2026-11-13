import {
  checkPublicUrl,
  childSchemas,
  type Id,
  isAddressHost,
  isJsonSchemaNode,
  isSmallJsonSchema,
  type JsonSchemaNode,
  type JsonValue,
  jsonValueSchema,
} from "@binference/core";
import { type ProtocolId, protocolIdSchema } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "../tools/agent-tool-texts.js";

/** The MCP revisions a listing may name: the one its review tested (decision 0429). */
export type McpRevision = "2025-06-18" | "2025-11-25" | "2026-07-28";

/** One read tool of an MCP listing, pinned as its review read it (decision 0429). */
export interface ListedMcpTool {
  /** Its name as the server's `tools/list` gives it. */
  readonly server: string;
  /** The name binference gives it; the model calls `mcp-<name>-<as>`. */
  readonly as: string;
  /** Always `read`: a listed tool never proposes, controls or runs anything. */
  readonly kind: "read";
  /** The reviewed words the model reads, never the server's live description. */
  readonly description: string;
  /** The JSON Schema binference checks arguments with and shows the model. */
  readonly input: JsonSchemaNode;
  /** The JSON Schema of the tool's `structuredContent`, when it answers one. */
  readonly output?: JsonSchemaNode;
  /**
   * The SHA-256, in hex, of the tool's `name`, `inputSchema` and `outputSchema` as the review read
   * them from the server, as canonical JSON (RFC 8785).
   */
  readonly serverDigest: string;
}

/** The listing catalog's entry for one outside MCP server, as the runtime reads it (decision 0429). */
export interface McpListing {
  readonly listing: ProtocolId<"mcpListing">;
  /** Rises with each reviewed change. */
  readonly version: number;
  /** 2 to 16 of `[a-z0-9]`, starting with a letter: the middle of its tools' names. */
  readonly name: string;
  /** What the model and the owner read as the server's name. */
  readonly title: string;
  /** The server's MCP endpoint: `https:`, a DNS name, port 443, as the URL parser writes it. */
  readonly url: string;
  readonly revision: McpRevision;
  /** How long one call may take, 1,000 to 20,000 milliseconds (decision 0430). */
  readonly timeoutMs: number;
  /** The most bytes one answer may hold, 4,096 to 1,048,576 (decision 0430). */
  readonly maxBytes: number;
  readonly tools: readonly ListedMcpTool[];
}

/** A listing in force for the install, with the agents that have it on (decision 0428). */
export interface ListedMcpServer {
  readonly listing: McpListing;
  readonly agents: readonly Id<"agt">[];
}

/** A {@link ListedMcpTool} as JSON carries it, its schemas not yet read. */
interface ListedMcpToolWire extends Omit<ListedMcpTool, "input" | "output"> {
  readonly input: Readonly<Record<string, unknown>>;
  readonly output?: Readonly<Record<string, unknown>>;
}

/** A {@link ListedMcpServer} as JSON carries it. */
export interface ListedMcpServerWire {
  readonly listing: Omit<McpListing, "listing" | "tools"> & {
    readonly listing: string;
    readonly tools: readonly ListedMcpToolWire[];
  };
  readonly agents: readonly string[];
}

/** Why a listing is refused, as `runtime.listing_refused` names it. */
export type ListingRefusal = "shape" | "url" | "schema" | "bounds" | "name_taken" | "repeated";

/**
 * How many listings one agent may have on, how many tools one listing may hold, how many listings
 * are in force, and the bytes one listing and the whole set may take as JSON (decision 0429).
 */
export const listingLimits: {
  readonly perAgent: number;
  readonly tools: number;
  readonly inForce: number;
  readonly listingBytes: number;
  readonly setBytes: number;
} = { perAgent: 4, tools: 8, inForce: 64, listingBytes: 64 * 1_024, setBytes: 512 * 1_024 };

const encoder = new TextEncoder();

/** The bytes a value takes as the settings line's JSON carries it. */
export function jsonBytesOf(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

const listingNamePattern = /^[a-z][a-z0-9]{1,15}$/;
const toolAsPattern = /^[a-z][a-z0-9_]{0,39}$/;
const serverToolPattern = /^[A-Za-z0-9_./-]{1,128}$/;
// Printable text: no control, invisible or unassigned character.
const titlePattern = /^[^\p{C}]{1,40}$/u;
const digestPattern = /^[0-9a-f]{64}$/;
const maxStringLength = 1_000;
const maxArrayItems = 100;
const schemaNotes: ReadonlySet<string> = new Set(["$schema"]);

/** The name the model calls a listed tool by: `mcp-<name>-<as>`, which no other tool's can be. */
export function listedToolName(
  listing: Pick<McpListing, "name">,
  tool: Pick<ListedMcpTool, "as">,
): string {
  return `mcp-${listing.name}-${tool.as}`;
}

// The URL guard's check, then the rules of decision 0429: https, a DNS name, port 443, nothing
// after a fragment mark, and written as the URL parser writes it, so a request is matched exactly.
function isListedUrl(text: string): boolean {
  const checked = checkPublicUrl(text);
  if (!checked.ok) {
    return false;
  }
  const url = checked.value;
  return (
    url.protocol === "https:" &&
    !isAddressHost(url.hostname) &&
    url.port === "" &&
    !text.includes("#") &&
    url.href === text
  );
}

function isAtMost(value: JsonValue | undefined, most: number): boolean {
  return typeof value === "number" && value <= most;
}

// What bounds a node of each type: an object names its fields alone, a string has a maxLength, an
// array a maxItems and its items; a number, a boolean or null is bounded as it is.
const typeBounds: ReadonlyMap<string, (node: JsonSchemaNode) => boolean> = new Map([
  ["object", (node: JsonSchemaNode) => node["additionalProperties"] === false],
  ["string", (node: JsonSchemaNode) => isAtMost(node["maxLength"], maxStringLength)],
  [
    "array",
    (node: JsonSchemaNode) =>
      isAtMost(node["maxItems"], maxArrayItems) && node["items"] !== undefined,
  ],
  ["number", () => true],
  ["integer", () => true],
  ["boolean", () => true],
  ["null", () => true],
]);

const combinators = ["anyOf", "oneOf", "allOf"] as const;

// An input node is bounded: an enum or a const, a combinator, or a node of a type it bounds.
function isBoundedNode(node: JsonSchemaNode): boolean {
  if (node["enum"] !== undefined || node["const"] !== undefined) {
    return true;
  }
  const type = node["type"];
  if (type === undefined) {
    return combinators.some((keyword) => node[keyword] !== undefined);
  }
  const bound = typeof type === "string" ? typeBounds.get(type) : undefined;
  return bound?.(node) ?? false;
}

// Every node of an input schema is bounded, so what the agent sends has a size the review saw.
function isBoundedInput(schema: JsonSchemaNode): boolean {
  const pending: JsonValue[] = [schema];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (!isJsonSchemaNode(node) || !isBoundedNode(node)) {
      return false;
    }
    pending.push(...childSchemas(node));
  }
  return schema["type"] === "object";
}

const builtInNames: ReadonlySet<string> = new Set(Object.keys(agentToolTexts));

// A server's tool name as binference compares it with its own: lowercase, with `-`, `.`, `/` and
// spaces as `_`.
function folded(name: string): string {
  return name.toLowerCase().replace(/[-./ ]/g, "_");
}

function takesNoBuiltInName(tools: readonly ListedMcpTool[]): boolean {
  return tools.every(
    (tool) => !builtInNames.has(tool.as) && !builtInNames.has(folded(tool.server)),
  );
}

function distinct(names: readonly string[]): boolean {
  return new Set(names).size === names.length;
}

const schemaObject: z.ZodType<JsonSchemaNode, Readonly<Record<string, unknown>>> = z
  .record(z.string(), jsonValueSchema)
  .refine((schema) => isSmallJsonSchema(schema, schemaNotes), { message: "schema" });

const toolSchema: z.ZodType<ListedMcpTool, ListedMcpToolWire> = z.strictObject({
  server: z.string().regex(serverToolPattern),
  as: z.string().regex(toolAsPattern),
  kind: z.literal("read"),
  description: z.string().min(1).max(1_000),
  input: schemaObject.refine(isBoundedInput, { message: "bounds" }),
  output: schemaObject.exactOptional(),
  serverDigest: z.string().regex(digestPattern),
});

/** Reads one MCP listing by the rules of decision 0429; the issue's message names the refusal. */
export const mcpListingSchema: z.ZodType<McpListing, ListedMcpServerWire["listing"]> =
  z.strictObject({
    listing: protocolIdSchema("mcpListing"),
    version: z.int().positive(),
    name: z.string().regex(listingNamePattern),
    title: z.string().regex(titlePattern),
    url: z.string().refine(isListedUrl, { message: "url" }),
    revision: z.enum(["2025-06-18", "2025-11-25", "2026-07-28"]),
    timeoutMs: z.int().min(1_000).max(20_000),
    maxBytes: z.int().min(4_096).max(1_048_576),
    tools: z
      .array(toolSchema)
      .min(1)
      .max(listingLimits.tools)
      .refine((tools) => distinct(tools.map(({ as }) => as)), { message: "repeated" })
      .refine((tools) => distinct(tools.map(({ server }) => server)), { message: "repeated" })
      .refine(takesNoBuiltInName, { message: "name_taken" }),
  });

/**
 * Reads one listing in force with the agents that have it on, at least one and each once, at most
 * 64 KiB as JSON.
 */
export const listedMcpServerSchema: z.ZodType<ListedMcpServer, ListedMcpServerWire> = z
  .strictObject({
    listing: mcpListingSchema,
    agents: z
      .array(protocolIdSchema("agent"))
      .min(1)
      .max(64)
      .refine(distinct, { message: "bounds" }),
  })
  .refine((server) => jsonBytesOf(server) <= listingLimits.listingBytes, { message: "bounds" });

const refusals: ReadonlySet<string> = new Set<ListingRefusal>([
  "url",
  "schema",
  "bounds",
  "name_taken",
  "repeated",
]);

function isListingRefusal(text: string): text is ListingRefusal {
  return refusals.has(text);
}

/**
 * Why a listing the source gave is refused, the first issue's reason, or none for one the schema
 * takes. The composition root leaves such a listing out of the settings.
 */
export function listingRefusal(value: unknown): ListingRefusal | undefined {
  const parsed = listedMcpServerSchema.safeParse(value);
  if (parsed.success) {
    return undefined;
  }
  const message = parsed.error.issues[0]?.message ?? "";
  return isListingRefusal(message) ? message : "shape";
}

function namesAreDistinct(servers: readonly ListedMcpServer[]): boolean {
  return distinct(servers.map(({ listing }) => listing.name));
}

function fitsPerAgent(servers: readonly ListedMcpServer[]): boolean {
  const counts = new Map<string, number>();
  for (const server of servers) {
    for (const agent of server.agents) {
      counts.set(agent, (counts.get(agent) ?? 0) + 1);
    }
  }
  return [...counts.values()].every((count) => count <= listingLimits.perAgent);
}

/**
 * Reads the settings' `listedMcp` (runtime spec, section 5.5): at most 64 listings, their names
 * distinct, at most 4 on for any agent, and at most 512 KiB as JSON in all, so the settings line
 * stays well inside its 1 MiB.
 */
export const listedMcpServersSchema: z.ZodType<
  readonly ListedMcpServer[],
  readonly ListedMcpServerWire[]
> = z
  .array(listedMcpServerSchema)
  .max(listingLimits.inForce)
  .refine(namesAreDistinct, { message: "repeated" })
  .refine(fitsPerAgent, { message: "bounds" })
  .refine((servers) => jsonBytesOf(servers) <= listingLimits.setBytes, { message: "bounds" });
