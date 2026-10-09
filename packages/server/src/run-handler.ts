import {
  type Clock,
  createDeadline,
  err,
  type IdSource,
  type JsonValue,
  jsonValueSchema,
  type Logger,
  ok,
  type Result,
  stableJson,
} from "@binference/core";
import { type IdempotencyLookup, sha256Hex } from "@binference/engine";
import {
  type CallFrame,
  type CallOf,
  type FailFrame,
  type OperationCall,
  type OperationName,
  operations,
  type ProtocolError,
  type ProtocolErrorCode,
  type ReplyFrame,
  storableArgs,
} from "@binference/protocol";
import { faultFailure, refusalFailure } from "./call-failure.js";
import { encodeResult } from "./encode-result.js";
import type { IdempotentWrites, WriteOutcome } from "./idempotent-writes.js";
import type { Caller, OperationHandlers } from "./operation-handlers.js";

/** A checked call whose handler runs. */
export interface HandlerRun {
  /** The frame as the client sent it; a write's key and args hash come from it. */
  readonly frame: CallFrame;
  readonly call: OperationCall;
  readonly caller: Caller;
  /** Aborts when the call's connection closes. */
  readonly closed: AbortSignal;
}

/** What a handler runs with. */
export interface RunContext {
  readonly handlers: OperationHandlers;
  readonly writes: IdempotentWrites;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly logger: Logger;
  readonly callTimeoutMs: number;
  /** Aborts when the server stops. */
  readonly signal: AbortSignal;
}

type Settled =
  | { readonly kind: "done"; readonly outcome: WriteOutcome }
  | { readonly kind: "threw"; readonly error: Error | undefined }
  | { readonly kind: "aborted" };

async function invoke<N extends OperationName>(
  call: CallOf<N>,
  caller: Caller,
  context: { readonly handlers: OperationHandlers; readonly signal: AbortSignal },
): Promise<Result<JsonValue, ProtocolErrorCode>> {
  const handler = context.handlers[call.op];
  if (handler === undefined) {
    return err("protocol.unknown_op");
  }
  const answered = await handler({ args: call.args, caller, signal: context.signal });
  return answered.ok ? ok(encodeResult(operations[call.op], answered.value)) : answered;
}

function lookupOf(run: HandlerRun): IdempotencyLookup {
  return {
    credential: run.caller.credential,
    op: run.call.op,
    key: run.frame.key ?? "",
    // The hash leaves out secret args, so the store holds no trace of a passphrase.
    argsHash: sha256Hex(
      stableJson(storableArgs(run.call.op, jsonValueSchema.parse(run.frame.args))),
    ),
  };
}

async function settle(working: Promise<WriteOutcome>): Promise<Settled> {
  try {
    return { kind: "done", outcome: await working };
  } catch (error) {
    return { kind: "threw", error: error instanceof Error ? error : undefined };
  }
}

function whenAborted(signal: AbortSignal): Promise<Settled> {
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ kind: "aborted" }), { once: true });
  });
}

// The server's own stop aborts its signal; any other abort is the call's deadline.
function abortFailure(server: AbortSignal): ProtocolError {
  return server.aborted
    ? { code: "engine.stopping", message: "The server stopped during the call.", retryable: true }
    : { code: "engine.timeout", message: "The call ran out of time.", retryable: true };
}

function frameOf(id: string, settled: Settled, context: RunContext): ReplyFrame | FailFrame {
  if (settled.kind === "aborted") {
    return { t: "fail", id, error: abortFailure(context.signal) };
  }
  if (settled.kind === "threw") {
    return { t: "fail", id, error: faultFailure(settled.error, context) };
  }
  return settled.outcome.ok
    ? { t: "reply", id, result: settled.outcome.value }
    : { t: "fail", id, error: refusalFailure(settled.outcome.error) };
}

/**
 * Runs a call's handler and gives the frame that answers it. A write runs through the idempotent
 * writes, so its result is stored before the reply. The handler's signal aborts at the call's
 * timeout (`engine.timeout`) or when the server stops (`engine.stopping`); a read's also when its
 * connection closes. A write keeps running after a timeout, and its result is still stored.
 */
export async function runHandler(
  run: HandlerRun,
  context: RunContext,
): Promise<ReplyFrame | FailFrame> {
  const isWrite = operations[run.call.op].idempotency === "key";
  const deadline = createDeadline({
    clock: context.clock,
    signal: isWrite ? context.signal : AbortSignal.any([context.signal, run.closed]),
    timeoutMs: context.callTimeoutMs,
  });
  const handlerContext = { handlers: context.handlers, signal: deadline.signal };
  const work = async (): Promise<Result<JsonValue, ProtocolErrorCode>> =>
    invoke(run.call, run.caller, handlerContext);
  try {
    const working = (async (): Promise<WriteOutcome> =>
      isWrite ? context.writes.run({ lookup: lookupOf(run), work }) : work())();
    const settled = await Promise.race([settle(working), whenAborted(deadline.signal)]);
    return frameOf(run.frame.id, settled, context);
  } finally {
    deadline.clear();
  }
}
