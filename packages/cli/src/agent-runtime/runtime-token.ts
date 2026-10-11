import { Buffer } from "node:buffer";
import {
  BinferenceError,
  type Clock,
  createIdSource,
  type Id,
  type Random,
} from "@binference/core";
import { type AccessStore, sha256Hex } from "@binference/engine";

/** The token made for one runtime start: the secret it signs in with, and the record's id. */
export interface RuntimeToken {
  /** A secret: it reaches the runtime on its standard input and nowhere else. */
  readonly token: string;
  readonly id: Id<"tok">;
  /** The runtime tokens the new one replaced, now revoked. */
  readonly revoked: readonly Id<"tok">[];
}

/** What the engine makes the runtime's tokens with. */
export interface RuntimeTokenOptions {
  readonly access: Pick<AccessStore, "replaceRuntimeToken">;
  readonly clock: Clock;
  readonly random: Random;
}

/**
 * Makes a new client token for one runtime start (runtime spec, section 2.1): kind `runtime`,
 * scopes `read`, `propose` and `agent`, stored only as its SHA-256, with every runtime token
 * before it revoked in the same write. Throws `cli.runtime_token_taken` in the rare case that the
 * new token's id or secret is already stored.
 */
export async function makeRuntimeToken(
  options: RuntimeTokenOptions,
  signal: AbortSignal,
): Promise<RuntimeToken> {
  const token = `bnt_${Buffer.from(options.random.bytes(32)).toString("base64url")}`;
  const id = createIdSource(options).next("tok");
  const replaced = await options.access.replaceRuntimeToken(
    {
      id,
      label: "runtime",
      kind: "runtime",
      scopes: ["read", "propose", "agent"],
      secretHash: sha256Hex(token),
      createdAtMs: options.clock.now(),
    },
    { signal },
  );
  if (!replaced.ok) {
    throw new BinferenceError({
      code: "cli.runtime_token_taken",
      message: "A new runtime token matched one the store holds.",
    });
  }
  return { token, id, revoked: replaced.value };
}
