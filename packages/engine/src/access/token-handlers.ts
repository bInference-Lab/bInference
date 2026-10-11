import { type Clock, err, type IdSource, ok } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import type { EngineHandler } from "../operations/engine-call.js";
import type { AccessStore } from "../ports.js";
import { sha256HexSchema } from "../records/sha256-hex.js";
import type { TokenRecord } from "./token-record.js";

/** The handlers of the client tokens (protocol spec, section 7.9; decision 0154). */
export interface TokenHandlers {
  readonly "token/list": EngineHandler<"token/list">;
  readonly "token/register": EngineHandler<"token/register">;
  readonly "token/revoke": EngineHandler<"token/revoke">;
}

/** What the token handlers read and write through. */
export interface TokenHandlersOptions {
  readonly access: AccessStore;
  readonly clock: Clock;
  readonly ids: IdSource;
}

type TokenView = ResultOf<"token/register">;

/** A token as the protocol shows it: never its hash. */
function tokenViewOf(record: TokenRecord): TokenView {
  return {
    token: record.id,
    label: record.label,
    kind: record.kind,
    scopes: record.scopes,
    createdAt: record.createdAtMs,
    ...(record.lastUsedAtMs === undefined ? {} : { lastUsedAt: record.lastUsedAtMs }),
    ...(record.revokedAtMs === undefined ? {} : { revokedAt: record.revokedAtMs }),
  };
}

/**
 * Creates the token handlers. `token/list` answers every client token, oldest first, revoked ones
 * too, without their hashes. `token/register` stores a token the CLI made from the SHA-256 of its
 * secret alone, so no secret reaches the engine or its idempotency store; a hash the store holds
 * is `protocol.bad_args`. `token/revoke` revokes a token, keeping the time of an earlier revoke;
 * an unknown one is `token.not_found`.
 */
export function createTokenHandlers(options: TokenHandlersOptions): TokenHandlers {
  return {
    async "token/list"({ signal }) {
      const tokens = await options.access.listTokens({ signal });
      return ok({ items: tokens.map(tokenViewOf) });
    },
    async "token/register"({ args, signal }) {
      const secretHash = sha256HexSchema.parse(args.secretHash);
      if ((await options.access.findToken(secretHash, { signal })) !== undefined) {
        return err("protocol.bad_args");
      }
      const added = await options.access.addToken(
        {
          id: options.ids.next("tok"),
          label: args.label,
          kind: args.kind,
          scopes: args.scopes,
          secretHash,
          createdAtMs: options.clock.now(),
        },
        { signal },
      );
      return added.ok ? ok(tokenViewOf(added.value)) : err("protocol.bad_args");
    },
    async "token/revoke"({ args, signal }) {
      const revoked = await options.access.revokeToken(
        { id: args.token, atMs: options.clock.now() },
        { signal },
      );
      return revoked.ok ? ok({}) : err("token.not_found");
    },
  };
}
