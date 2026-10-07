import { idempotencyKeySchema, type JsonSchema } from "@binference/protocol";
import type { StandardSchemaV1, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";

/**
 * What a tool's handler gets: the operation's decoded args, and the request id the MCP client
 * sent with them, when the tool takes one.
 */
export interface ToolInput<Args> {
  readonly args: Args;
  /** The call's idempotency key: a retry with the same id returns the first result. */
  readonly requestId?: string;
}

/** A tool's input schema: any JSON in, the operation's decoded args and the request id out. */
export type ToolInputSchema<Args> = StandardSchemaWithJSON<unknown, ToolInput<Args>>;

/** How a tool's input is checked: the operation's args, and whether a request id may come. */
export interface ToolInputRules<Args> {
  readonly args: z.ZodType<Args>;
  /** What `tools/list` shows. */
  readonly json: JsonSchema;
  readonly takesRequestId: boolean;
}

type Checked<Args> = StandardSchemaV1.Result<ToolInput<Args>>;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The request id leaves the input before the args schema, which refuses unknown fields, sees it.
function splitRequestId(value: unknown): { readonly rest: unknown; readonly requestId?: unknown } {
  if (!isObject(value) || !("requestId" in value)) {
    return { rest: value };
  }
  const { requestId, ...rest } = value;
  return { rest, requestId };
}

async function check<Args>(rules: ToolInputRules<Args>, value: unknown): Promise<Checked<Args>> {
  const { rest, requestId } = rules.takesRequestId ? splitRequestId(value) : { rest: value };
  const id = requestId === undefined ? undefined : idempotencyKeySchema.safeParse(requestId);
  if (id?.success === false) {
    const message = "Expected requestId to be text of 1 to 64 characters.";
    return { issues: [{ message, path: ["requestId"] }] };
  }
  const checked = await rules.args["~standard"].validate(rest);
  if (checked.issues !== undefined) {
    return { issues: checked.issues };
  }
  return { value: { args: checked.value, ...(id === undefined ? {} : { requestId: id.data }) } };
}

/**
 * A tool's input schema as the MCP SDK takes it: `json` is what `tools/list` shows, and the
 * operation's own args schema checks each `tools/call` and hands the handler the decoded args, so
 * an amount arrives as a `bigint`. A call the args schema refuses never reaches the engine. For a
 * tool that takes one, a `requestId` of 1 to 64 characters is taken out before the args are
 * checked.
 */
export function toolInputSchema<Args>(rules: ToolInputRules<Args>): ToolInputSchema<Args> {
  const copy = (): Record<string, unknown> => ({ ...rules.json });
  return {
    "~standard": {
      version: 1,
      vendor: "binference",
      validate: async (value: unknown) => check(rules, value),
      jsonSchema: { input: copy, output: copy },
    },
  };
}
