import { type Id, idSchema, type Result } from "@binference/core";
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
  /** When the token stops signing in; absent for a token that works until it is revoked. */
  readonly expiresAtMs?: number;
}

/**
 * What saving the runtime's token for a new start answers: the ids of the runtime tokens it
 * revoked, or why it saved nothing.
 */
export type RuntimeTokenReplaced = Result<readonly Id<"tok">[], "exists" | "not_runtime">;

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
  expiresAtMs: epochMsSchema.exactOptional(),
});
