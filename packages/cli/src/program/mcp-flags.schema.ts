import { z } from "zod";
import { type McpClient, mcpClients } from "../compose/mcp-token.js";
import type { CommonOptions } from "./cli-flags.schema.js";

/** What `binference mcp` takes: the client whose token it signs in with. */
export interface McpFlags extends CommonOptions {
  /** `auth/mcp.token` when left out. */
  readonly client?: McpClient;
}

/** Parses the options commander read for `binference mcp`. */
export const mcpFlagsSchema: z.ZodType<McpFlags> = z.object({
  json: z.boolean().default(false),
  yes: z.boolean().default(false),
  client: z.enum(mcpClients).exactOptional(),
});

/** What `binference mcp setup` takes: the client, and whether it only shows or undoes the setup. */
export interface McpSetupFlags extends CommonOptions {
  readonly client: McpClient;
  /** `--dry-run`: say what would change, and change nothing. */
  readonly isDryRun: boolean;
  /** `--remove`: undo the setup and revoke the client's token. */
  readonly isRemove: boolean;
  /** `--ttl`: a new token that expires this long after it is made; none expires when left out. */
  readonly ttlMs?: number;
}

/** Parses the options commander read for `binference mcp setup`. */
export const mcpSetupFlagsSchema: z.ZodType<McpSetupFlags> = z
  .object({
    json: z.boolean().default(false),
    yes: z.boolean().default(false),
    client: z.enum(mcpClients),
    dryRun: z.boolean().default(false),
    remove: z.boolean().default(false),
    ttl: z.int().positive().exactOptional(),
  })
  .transform(({ dryRun, remove, ttl, ...rest }) => ({
    ...rest,
    isDryRun: dryRun,
    isRemove: remove,
    ...(ttl === undefined ? {} : { ttlMs: ttl }),
  }));

/** The lifetime of an MCP session's token when `--ttl` is left out: 1 hour (decision 0159). */
const sessionTtlDefaultMs = 3_600_000;

/** The longest an MCP session's token may live: 24 hours (decision 0159). */
export const sessionTtlMaxMs = 86_400_000;

/** What `binference mcp session` takes: the client, its token's lifetime and the client's own args. */
export interface McpSessionFlags extends CommonOptions {
  readonly client: McpClient;
  readonly ttlMs: number;
  /** `--print-config`: print the config and the token for a client started by hand. */
  readonly isPrintConfig: boolean;
  /** The arguments after `--`, passed to the client as they are. */
  readonly clientArgs: readonly string[];
}

/** Parses the options commander read for `binference mcp session`, and the client's arguments. */
export const mcpSessionFlagsSchema: z.ZodType<McpSessionFlags> = z
  .object({
    json: z.boolean().default(false),
    yes: z.boolean().default(false),
    client: z.enum(mcpClients),
    ttl: z.int().positive().default(sessionTtlDefaultMs),
    printConfig: z.boolean().default(false),
    clientArgs: z.array(z.string()).default([]),
  })
  .transform(({ ttl, printConfig, ...rest }) => ({
    ...rest,
    ttlMs: ttl,
    isPrintConfig: printConfig,
  }));
