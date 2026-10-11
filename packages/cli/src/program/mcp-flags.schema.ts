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
}

/** Parses the options commander read for `binference mcp setup`. */
export const mcpSetupFlagsSchema: z.ZodType<McpSetupFlags> = z
  .object({
    json: z.boolean().default(false),
    yes: z.boolean().default(false),
    client: z.enum(mcpClients),
    dryRun: z.boolean().default(false),
    remove: z.boolean().default(false),
  })
  .transform(({ dryRun, remove, ...rest }) => ({ ...rest, isDryRun: dryRun, isRemove: remove }));
