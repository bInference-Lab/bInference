import { type Id, idSchema } from "@binference/core";
import { type Scope, scopeSchema } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/** What a client token is for: the CLI, the agent runtime, the MCP server, or one the owner made. */
export type TokenKind = "cli" | "runtime" | "mcp" | "custom";

/**
 * A client token as the store keeps it: its scopes and the SHA-256 of its `bnt_` secret, never
 * the secret itself.
 */
export interface TokenRecord {
  readonly id: Id<"tok">;
  readonly label: string;
  readonly kind: TokenKind;
  readonly scopes: readonly Scope[];
  readonly secretHash: Sha256Hex;
  readonly createdAtMs: number;
  readonly lastUsedAtMs?: number;
  readonly revokedAtMs?: number;
}

/** Parses a token record. */
export const tokenRecordSchema: z.ZodType<TokenRecord> = z.strictObject({
  id: idSchema("tok"),
  label: z.string().min(1).max(64),
  kind: z.enum(["cli", "runtime", "mcp", "custom"]),
  scopes: z.array(scopeSchema),
  secretHash: sha256HexSchema,
  createdAtMs: epochMsSchema,
  lastUsedAtMs: epochMsSchema.exactOptional(),
  revokedAtMs: epochMsSchema.exactOptional(),
});
