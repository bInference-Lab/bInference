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
}

/** One call the protocol server checked and routed to the engine. */
export interface EngineCall<N extends OperationName> {
  /** The args after the operation's schema parsed them, so amounts are `bigint`. */
  readonly args: ArgsOf<N>;
  readonly caller: EngineCaller;
  readonly signal: AbortSignal;
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

/**
 * Who proposes, from the scopes the server signed the caller in with: the agent runtime holds
 * `agent`, the owner's CLI and console devices hold `confirm`, and any other client is an MCP
 * client, which the auto test never lets skip a card. The owner's Telegram chat proposes as the
 * owner. Any other credential that is neither a token nor a device proposes nothing.
 */
export function proposerOf(caller: EngineCaller): Proposer | undefined {
  const { credential, scopes } = caller;
  if (caller.client.kind === "telegram") {
    return scopes.includes("confirm") ? { role: "owner", ref: "telegram" } : undefined;
  }
  if (!isCredentialId(credential)) {
    return undefined;
  }
  if (scopes.includes("agent")) {
    return { role: "agent_runtime", ref: credential };
  }
  return { role: scopes.includes("confirm") ? "owner" : "mcp_client", ref: credential };
}

/**
 * The surface a caller answers and changes things on: Telegram, the console or the Mini App, and
 * the CLI for every other client.
 */
export function answererOf(caller: EngineCaller): Answerer {
  const { kind } = caller.client;
  const surface = kind === "console" || kind === "mini" || kind === "telegram" ? kind : "cli";
  return { surface, by: caller.credential };
}
