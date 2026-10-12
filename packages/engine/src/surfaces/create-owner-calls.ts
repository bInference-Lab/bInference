import { BinferenceError, err, type Result } from "@binference/core";
import {
  type ArgsOf,
  localeSchema,
  type ProtocolErrorCode,
  protocolErrorCodes,
  type ResultOf,
  type Scope,
} from "@binference/protocol";
import { z } from "zod";
import type { EngineCaller, EngineHandler, EngineHandlerTable } from "../operations/engine-call.js";

/**
 * The operations the owner's Telegram chat runs: the fast commands' reads and the braking that
 * rule 11 allows from any surface, and `chat/post`, the owner's message to the agent. None is
 * local or takes the owner key. `limit/set` runs with `confirm` alone, so its handler takes only
 * a stricter limit (decision 0111). `config/change` runs only to set `owner.locale`, the one
 * exception to its `admin` scope (decision 0134).
 */
export const ownerChatOperations = [
  "engine/status",
  "safety/status",
  "safety/freeze",
  "safety/rescue",
  "agent/goPaper",
  "limit/get",
  "limit/set",
  "portfolio/get",
  "order/list",
  "wallet/list",
  "usage/get",
  "config/change",
  "chat/post",
] as const;

/** An operation the owner's fast commands run. */
export type OwnerChatOperation = (typeof ownerChatOperations)[number];

/**
 * The scopes the owner holds in their Telegram chat: reading, braking, which also answers cards
 * (ARCHITECTURE.md rule 11), and chatting with the agent. Loosening and settings need the CLI,
 * the console or the Mini App, never a chat message.
 */
export const ownerChatScopes: readonly Scope[] = ["read", "confirm", "chat"];

/** The handlers the fast commands run, by operation: the engine's and the composition root's. */
export type OwnerChatHandlers = Pick<EngineHandlerTable, OwnerChatOperation>;

/** One operation a fast command runs, for the Telegram user who sent the command. */
export interface OwnerCall<N extends OwnerChatOperation> {
  readonly op: N;
  readonly args: ArgsOf<N>;
  /** The sender's numeric Telegram id; the operation runs only for the owner's. */
  readonly senderId: number;
}

/**
 * Runs the fast commands' operations inside the engine, for the owner alone: the engine's side of
 * Telegram's `OwnerCalls` port.
 */
export interface OwnerCalls {
  /**
   * Runs one operation as the owner on Telegram and answers its result, or the protocol error
   * code it refused with: `auth.scope` for a sender who is not the owner, `protocol.unknown_op`
   * when the engine does not serve the operation yet. A handler's fault with a protocol code
   * answers that code; any other fault is thrown.
   */
  call<N extends OwnerChatOperation>(
    request: OwnerCall<N>,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<ResultOf<N>, ProtocolErrorCode>>;
}

/** What {@link createOwnerCalls} runs operations through. */
export interface OwnerCallsOptions {
  readonly handlers: OwnerChatHandlers;
  /** The owner's numeric Telegram id, or `undefined` before the owner pairs. */
  readonly ownerId: (options: { readonly signal: AbortSignal }) => Promise<number | undefined>;
}

const protocolCodes: ReadonlySet<string> = new Set(protocolErrorCodes);

// The one setting the owner's chat changes past its scopes: the owner's language (decision 0134).
const ownerLocalePatchSchema = z.strictObject({
  owner: z.strictObject({ locale: localeSchema }),
});

function isConfigChange(
  request: OwnerCall<OwnerChatOperation>,
): request is OwnerCall<"config/change"> {
  return request.op === "config/change";
}

// A call the chat's scopes allow, or the owner's language change, which alone passes `admin`.
function isAllowed(request: OwnerCall<OwnerChatOperation>): boolean {
  return !isConfigChange(request) || ownerLocalePatchSchema.safeParse(request.args.patch).success;
}

function isProtocolCode(code: string): code is ProtocolErrorCode {
  return protocolCodes.has(code);
}

// The owner on Telegram, as journals, ledger entries and notices name who acted and where.
function callerOf(senderId: number): EngineCaller {
  return {
    credential: `tg:${String(senderId)}`,
    client: { kind: "telegram" },
    scopes: ownerChatScopes,
  };
}

async function run<N extends OwnerChatOperation>(
  handler: EngineHandler<N>,
  request: OwnerCall<N>,
  signal: AbortSignal,
): Promise<Result<ResultOf<N>, ProtocolErrorCode>> {
  try {
    return await handler({ args: request.args, caller: callerOf(request.senderId), signal });
  } catch (error) {
    if (error instanceof BinferenceError && isProtocolCode(error.code)) {
      return err(error.code);
    }
    throw error;
  }
}

/**
 * Creates the {@link OwnerCalls} over the handlers. Each call runs as the owner on Telegram, with
 * the scopes {@link ownerChatScopes} names, so a freeze is journaled and announced as made from
 * Telegram and a rescue is proposed by the owner. A sender other than the owner runs nothing, and
 * a `config/change` of anything but `owner.locale` is `auth.scope` (decision 0134).
 */
export function createOwnerCalls(options: OwnerCallsOptions): OwnerCalls {
  return {
    async call(request, { signal }) {
      signal.throwIfAborted();
      const owner = await options.ownerId({ signal });
      if (owner === undefined || owner !== request.senderId || !isAllowed(request)) {
        return err("auth.scope");
      }
      const handler: EngineHandler<typeof request.op> | undefined = options.handlers[request.op];
      return handler === undefined ? err("protocol.unknown_op") : run(handler, request, signal);
    },
  };
}
