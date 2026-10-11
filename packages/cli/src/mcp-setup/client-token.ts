import { Buffer } from "node:buffer";
import { dirname } from "node:path";
import type { ProtocolClient } from "@binference/client";
import { sha256Hex } from "@binference/engine";
import { ensurePrivateFolder, removePath, writePrivateFile } from "@binference/platform";
import type { ProtocolId } from "@binference/protocol";
import { signIn } from "../commands/connect-engine.js";
import { readCliToken } from "../compose/cli-token.js";
import { platformOf } from "../compose/engine-locations.js";
import { mcpTokenFile } from "../compose/mcp-token.js";
import type { SetupChange, SetupRun } from "./setup-change.js";

// An MCP client reads and proposes, and nothing more (protocol spec, section 4.1).
const mcpScopes = ["read", "propose"] as const;

function tokenFileOf(run: SetupRun): string {
  return mcpTokenFile(platformOf(run.host).stateFolder, run.client);
}

async function signsIn(run: SetupRun, token: string): Promise<boolean> {
  const connection = await signIn(run.host, { token, kind: "mcp" }, run.signal);
  if (connection.ok) {
    connection.client.close();
  }
  return connection.ok;
}

// The client's tokens the engine still accepts, by their label.
async function liveTokens(
  run: SetupRun,
  engine: ProtocolClient,
): Promise<readonly ProtocolId<"clientToken">[]> {
  const { items } = await engine.call("token/list", {}, { signal: run.signal });
  return items
    .filter((token) => token.label === `mcp-${run.client}` && token.revokedAt === undefined)
    .map((token) => token.token);
}

async function revokeAll(run: SetupRun, engine: ProtocolClient): Promise<number> {
  const tokens = await liveTokens(run, engine);
  await Promise.all(
    tokens.map(async (token) => engine.call("token/revoke", { token }, { signal: run.signal })),
  );
  return tokens.length;
}

/**
 * Gives the client a token of its own (decision 0154): the one in `auth/mcp-<client>.token` while
 * it still signs in, else a new one. A new token's secret is made here and written owner-only to
 * that file; the engine gets only its SHA-256, through `token/register`, and the client's earlier
 * tokens are revoked.
 */
export async function ensureClientToken(
  run: SetupRun,
  engine: ProtocolClient,
): Promise<SetupChange> {
  const file = tokenFileOf(run);
  const current = await readCliToken(file, run.signal);
  if (current !== undefined && (await signsIn(run, current))) {
    return { part: "token", action: "unchanged", path: file };
  }
  const action = current === undefined ? "created" : "updated";
  if (run.isDryRun) {
    return { part: "token", action, path: file };
  }
  await revokeAll(run, engine);
  const token = `bnt_${Buffer.from(run.host.random.bytes(32)).toString("base64url")}`;
  const registration = {
    label: `mcp-${run.client}`,
    kind: "mcp" as const,
    scopes: [...mcpScopes],
    secretHash: sha256Hex(token),
  };
  await engine.call("token/register", registration, { signal: run.signal });
  const files = { permissions: platformOf(run.host).permissions, signal: run.signal };
  await ensurePrivateFolder(dirname(file), files);
  await writePrivateFile(file, `${token}\n`, files);
  return { part: "token", action, path: file };
}

/** Revokes every token of the client and removes its token file. */
export async function revokeClientToken(
  run: SetupRun,
  engine: ProtocolClient,
): Promise<SetupChange> {
  const file = tokenFileOf(run);
  const hasFile = (await readCliToken(file, run.signal)) !== undefined;
  const tokens = await liveTokens(run, engine);
  if (!hasFile && tokens.length === 0) {
    return { part: "token", action: "absent", path: file };
  }
  if (!run.isDryRun) {
    await revokeAll(run, engine);
    await removePath(file, run.signal);
  }
  return { part: "token", action: "removed", path: file };
}
