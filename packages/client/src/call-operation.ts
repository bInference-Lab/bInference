import { BinferenceError, type Clock, createDeadline, type IdSource } from "@binference/core";
import type { CallFrame, Operation } from "@binference/protocol";
import { z } from "zod";
import { clientError, errorFromFail } from "./client-error.js";
import type { ConnectionStatus } from "./connection-status.js";
import type { ClientLimits } from "./default-client-limits.js";
import type { CallAnswer, PendingCalls } from "./pending-calls.js";

/** What one call takes besides its args. */
export interface CallOptions {
  readonly signal: AbortSignal;
  /** How long to wait for the answer, across reconnects; the client's `callTimeoutMs` by default. */
  readonly timeoutMs?: number;
  /**
   * The idempotency key of an operation whose rule is `key`. Pass the same key to retry a write
   * after an error; without one, the client makes a key for the call. Other calls send no key.
   */
  readonly key?: string;
}

/** One call: an operation of the table and its args. */
export interface Invocation<Args, Result> {
  readonly operation: Operation<Args, Result>;
  readonly args: Args;
}

/** What a call runs on: the connection, the pending map, the limits, the clock and the ids. */
export interface CallContext {
  readonly status: ConnectionStatus;
  readonly pending: PendingCalls;
  readonly limits: ClientLimits;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly nextCallId: () => string;
}

/** Throws the reason the client closed, such as `auth.revoked`, once it has closed. */
export function refuseWhenClosed(context: CallContext): void {
  const status = context.status.current();
  if (status.state === "closed") {
    throw status.error;
  }
}

function settleAnswer<Args, Result>(request: Invocation<Args, Result>, answer: CallAnswer): Result {
  if (answer.t === "fail") {
    throw errorFromFail(answer.error);
  }
  const op = request.operation.name;
  // An explicit type argument keeps the generic result type; inference would widen it.
  const parsed = z.safeParse<z.ZodType<Result>>(request.operation.result, answer.result);
  if (!parsed.success) {
    throw clientError({
      code: "client.bad_reply",
      message: `The engine's result for ${op} breaks its schema.`,
      details: { op },
    });
  }
  return parsed.data;
}

function frameOf<Args, Result>(
  context: CallContext,
  request: Invocation<Args, Result>,
  options: CallOptions,
): CallFrame {
  const { operation } = request;
  const encoded = z.safeEncode<z.ZodType<Args>>(operation.args, request.args);
  if (!encoded.success) {
    throw new BinferenceError({
      code: "protocol.bad_args",
      message: `The args of ${operation.name} break its schema.`,
      details: { op: operation.name },
    });
  }
  return {
    t: "call",
    id: context.nextCallId(),
    op: operation.name,
    args: encoded.data,
    ...(operation.idempotency === "key" ? { key: options.key ?? context.ids.next("key") } : {}),
  };
}

/**
 * Sends one call and resolves with its parsed result. The call waits in the pending map until its
 * answer, its timeout or its abort, across reconnects. Rejects with the engine's code from a
 * `fail` frame, `client.bad_reply` for a result that breaks its schema, and `protocol.bad_args`,
 * before sending, for args that break theirs.
 */
export async function callOperation<Args, Result>(
  context: CallContext,
  request: Invocation<Args, Result>,
  options: CallOptions,
): Promise<Result> {
  refuseWhenClosed(context);
  const frame = frameOf(context, request, options);
  const timeoutMs = options.timeoutMs ?? context.limits.callTimeoutMs;
  const deadline = createDeadline({ clock: context.clock, signal: options.signal, timeoutMs });
  try {
    const answer = context.pending.wait(frame, deadline.signal);
    context.status.connection()?.send(frame);
    return settleAnswer(request, await answer);
  } finally {
    deadline.clear();
  }
}
