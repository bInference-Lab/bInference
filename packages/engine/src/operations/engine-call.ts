import { type Id, isId, type Result } from "@binference/core";
import type {
  ArgsOf,
  ClientInfo,
  OperationName,
  ProtocolErrorCode,
  ResultOf,
  Scope,
} from "@binference/protocol";
import type { Answerer } from "../confirmations/card-answer.js";
import type { Proposer } from "../money-path/create-money-path.js";

/**
 * A surface the engine serves itself, never over the protocol: the owner's Telegram chat, whose
 * fast commands run operations inside the engine (protocol spec, section 4.1).
 */
interface SurfaceClient {
  readonly kind: "telegram";
}

/** What the agent runtime knows of the turn it proposes in. */
export interface TurnMark {
  /** The turn read the web, X, a Telegram group or token data (`turns.outside_content`). */
  readonly hasOutsideContent: boolean;
}

/** Who makes a call: a client the protocol server signed in, or a surface the engine serves. */
export interface EngineCaller {
  /**
   * The credential's id, never its secret: a client token's `tok_` id, a device's `dev_` id, or
   * `tg:<id>` for the owner's numeric Telegram id.
   */
  readonly credential: string;
  /** What the client says it is, or the engine's own surface; it never decides what it may do. */
  readonly client: ClientInfo | SurfaceClient;
  /** The scopes the server, or the surface, checked the call against. */
  readonly scopes: readonly Scope[];
  /**
   * Where the call came in: `ipc`, the local socket, or `ws`. The server always sets it; a caller
   * without it counts as not local, so an owner-key operation refuses it.
   */
  readonly transport?: "ipc" | "ws";
  /**
   * The running turn of the agent the runtime proposes for, set only for a call made with the
   * token the engine made at the runtime's current start (`markRuntimeTurns`); the protocol server
   * never sets it, so no client can clear the mark. Without it, a proposal of a client with
   * `agent` counts as outside content.
   */
  readonly turn?: TurnMark;
}

/** One call the protocol server checked and routed to the engine. */
export interface EngineCall<N extends OperationName> {
  /** The args after the operation's schema parsed them, so amounts are `bigint`. */
  readonly args: ArgsOf<N>;
  readonly caller: EngineCaller;
  readonly signal: AbortSignal;
  /**
   * A write's idempotency key as its client sent it, for a handler that keeps a record per key;
   * a surface the engine serves itself sends none.
   */
  readonly key?: string;
}

/**
 * Answers one operation with its result, or refuses it with a protocol error code for an expected
 * outcome. It has the shape of the protocol server's operation handler, so the composition root
 * hands it to the server as is.
 */
export type EngineHandler<N extends OperationName> = (
  call: EngineCall<N>,
) => Promise<Result<ResultOf<N>, ProtocolErrorCode>>;

/**
 * Handlers by operation name: the engine's, and those the composition root answers, such as
 * `engine/status`. The protocol server routes calls to them, and so do the surfaces the engine
 * serves itself.
 */
export type EngineHandlerTable = { readonly [N in OperationName]?: EngineHandler<N> };

function isCredentialId(credential: string): credential is Id<"tok"> | Id<"dev"> {
  return isId("tok", credential) || isId("dev", credential);
}

// The owner on Telegram: the chat the engine serves itself, or a Mini App connection the server
// signed in with the owner's Telegram id, which no other credential carries.
function isTelegramOwner(caller: EngineCaller): boolean {
  return caller.client.kind === "telegram" || /^tg:[1-9][0-9]*$/.test(caller.credential);
}

/**
 * Who proposes, from the scopes the server signed the caller in with: the agent runtime holds
 * `agent`, the owner's CLI and console devices hold `confirm`, and any other client is an MCP
 * client, which the auto test never lets skip a card. The owner's Telegram chat and the Mini App
 * propose as the owner on Telegram. Any other credential that is neither a token nor a device
 * proposes nothing. A proposal of
 * the agent runtime carries the outside-content mark unless the caller's turn says it read none.
 */
export function proposerOf(caller: EngineCaller): Proposer | undefined {
  const { credential, scopes } = caller;
  if (isTelegramOwner(caller)) {
    return scopes.includes("confirm")
      ? { role: "owner", ref: "telegram", hasOutsideContent: false }
      : undefined;
  }
  if (!isCredentialId(credential)) {
    return undefined;
  }
  if (scopes.includes("agent")) {
    const hasOutsideContent = caller.turn?.hasOutsideContent ?? true;
    return { role: "agent_runtime", ref: credential, hasOutsideContent };
  }
  const role = scopes.includes("confirm") ? "owner" : "mcp_client";
  return { role, ref: credential, hasOutsideContent: false };
}

// The surface by the credential the server signed the caller in with, never by the client kind
// the client says it is: Telegram for the chat the engine serves itself, the Mini App for a `tg:`
// connection, the console for a device, and the CLI for a token.
function surfaceOf(caller: EngineCaller): Answerer["surface"] {
  if (caller.client.kind === "telegram") {
    return "telegram";
  }
  if (isTelegramOwner(caller)) {
    return "mini";
  }
  return isId("dev", caller.credential) ? "console" : "cli";
}

/**
 * The surface a caller answers and changes things on, as journals and receipts name it: decided by
 * its credential, so a client cannot pass itself off as another surface.
 */
export function answererOf(caller: EngineCaller): Answerer {
  return { surface: surfaceOf(caller), by: caller.credential };
}
