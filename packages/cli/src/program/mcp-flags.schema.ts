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
