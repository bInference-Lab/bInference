import { Buffer } from "node:buffer";
import { sha256Hex } from "@binference/engine";
import { type ArgsOf, mcpTokenScopes } from "@binference/protocol";
import type { CliHost } from "../program/cli-host.js";

/** A new MCP token: the secret the client signs in with, and what `token/register` gets of it. */
export interface McpRegistration {
  readonly secret: string;
  readonly args: ArgsOf<"token/register">;
}

/**
 * Makes a new `bnt_` secret of 32 random bytes and the `token/register` args for it (decisions
 * 0154 and 0159): the label, `read` and `propose`, the SHA-256 of the secret and the expiry, if
 * any. The secret never reaches the args.
 */
export function mcpRegistration(
  host: Pick<CliHost, "random">,
  label: string,
  expiresAt?: number,
): McpRegistration {
  const secret = `bnt_${Buffer.from(host.random.bytes(32)).toString("base64url")}`;
  const args = {
    label,
    kind: "mcp" as const,
    scopes: [...mcpTokenScopes],
    secretHash: sha256Hex(secret),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
  return { secret, args };
}
