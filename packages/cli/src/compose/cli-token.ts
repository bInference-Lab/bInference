import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { BinferenceError, type Clock, createIdSource, type Random } from "@binference/core";
import { type AccessStore, sha256Hex, type TokenRecord } from "@binference/engine";
import {
  ensurePrivateFolder,
  type FilePermissions,
  readTextFile,
  type StateFolder,
  writePrivateFile,
} from "@binference/platform";
import { clientTokenSchema } from "@binference/protocol";

/** What the engine needs to make sure the CLI can sign in. */
export interface CliTokenOptions {
  readonly access: Pick<AccessStore, "addToken" | "findToken">;
  /** The CLI's token file, `auth/cli.token` in the state folder. */
  readonly file: string;
  readonly permissions: FilePermissions;
  readonly clock: Clock;
  readonly random: Random;
  readonly signal: AbortSignal;
}

// The CLI holds every scope (protocol spec 4.1); it signs in over IPC only.
const cliScopes: TokenRecord["scopes"] = ["read", "propose", "chat", "confirm", "loosen", "admin"];

/** The CLI's token file in a state folder: `auth/cli.token`, owner-only. */
export function cliTokenFile(stateFolder: StateFolder): string {
  return join(stateFolder.root, "auth", "cli.token");
}

/**
 * Reads the CLI's token from its file: `undefined` when the file is missing or holds no token.
 * The token is a secret: it goes to the protocol client and nowhere else.
 */
export async function readCliToken(file: string, signal: AbortSignal): Promise<string | undefined> {
  const read = await readTextFile(file, signal);
  const parsed = read.ok ? clientTokenSchema.safeParse(read.value.trim()) : undefined;
  return parsed?.success === true ? parsed.data : undefined;
}

async function isKnown(options: CliTokenOptions, token: string): Promise<boolean> {
  const record = await options.access.findToken(sha256Hex(token), { signal: options.signal });
  return record !== undefined && record.revokedAtMs === undefined && record.kind === "cli";
}

/**
 * Makes sure the CLI can sign in to this engine: keeps the token in `auth/cli.token` when the
 * store knows it and it is not revoked, else makes a new one, stores only its SHA-256, and writes
 * the token to the file, owner-only. Answers which it did.
 */
export async function ensureCliToken(options: CliTokenOptions): Promise<"kept" | "created"> {
  const current = await readCliToken(options.file, options.signal);
  if (current !== undefined && (await isKnown(options, current))) {
    return "kept";
  }
  const token = `bnt_${Buffer.from(options.random.bytes(32)).toString("base64url")}`;
  const ids = createIdSource({ clock: options.clock, random: options.random });
  const added = await options.access.addToken(
    {
      id: ids.next("tok"),
      label: "cli",
      kind: "cli",
      scopes: cliScopes,
      secretHash: sha256Hex(token),
      createdAtMs: options.clock.now(),
    },
    { signal: options.signal },
  );
  if (!added.ok) {
    throw new BinferenceError({
      code: "cli.token_taken",
      message: "A new CLI token matched one the store holds; start binference again.",
    });
  }
  const files = { permissions: options.permissions, signal: options.signal };
  await ensurePrivateFolder(dirname(options.file), files);
  await writePrivateFile(options.file, `${token}\n`, files);
  return "created";
}
