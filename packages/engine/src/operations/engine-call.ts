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

/** Who makes a call, as the protocol server signed them in. */
export interface EngineCaller {
  /** The credential's id, never its secret: a client token's `tok_` id or a device's `dev_` id. */
  readonly credential: string;
  /** What the client says it is; it never decides what the caller may do. */
  readonly client: ClientInfo;
  /** The scopes the server checked the call against. */
  readonly scopes: readonly Scope[];
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

function isCredentialId(credential: string): credential is Id<"tok"> | Id<"dev"> {
  return isId("tok", credential) || isId("dev", credential);
}

/**
 * Who proposes, from the scopes the server signed the caller in with: the agent runtime holds
 * `agent`, the owner's CLI and console devices hold `confirm`, and any other client is an MCP
 * client, which the auto test never lets skip a card. A credential that is neither a token nor a
 * device proposes nothing.
 */
export function proposerOf(caller: EngineCaller): Proposer | undefined {
  const { credential, scopes } = caller;
  if (!isCredentialId(credential)) {
    return undefined;
  }
  if (scopes.includes("agent")) {
    return { role: "agent_runtime", ref: credential };
  }
  return { role: scopes.includes("confirm") ? "owner" : "mcp_client", ref: credential };
}

/** Who answers a card over the protocol: the console or the Mini App, and the CLI otherwise. */
export function answererOf(caller: EngineCaller): Answerer {
  const { kind } = caller.client;
  const surface = kind === "console" || kind === "mini" ? kind : "cli";
  return { surface, by: caller.credential };
}
