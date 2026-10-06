import { BinferenceError, type IdSource, type Logger } from "@binference/core";
import {
  type ProtocolError,
  type ProtocolErrorCode,
  protocolErrorCodes,
} from "@binference/protocol";

const protocolCodes: ReadonlySet<string> = new Set(protocolErrorCodes);

// The codes a call may meet again and pass later unchanged: the engine, the runtime or a provider
// was busy or away.
const retryableCodes: ReadonlySet<ProtocolErrorCode> = new Set([
  "protocol.busy",
  "engine.starting",
  "engine.stopping",
  "engine.locked",
  "engine.timeout",
  "runtime.unavailable",
  "wallet.custody_down",
  "name.resolver_down",
  "quote.venue_down",
  "chain.rpc_down",
]);

/**
 * The error of a `fail` frame for a call refused with an expected outcome. It is retryable when the
 * code says something was busy or away, such as `engine.timeout` or `chain.rpc_down`.
 */
export function refusalFailure(code: ProtocolErrorCode): ProtocolError {
  return {
    code,
    message: `The engine refused the call with ${code}.`,
    retryable: retryableCodes.has(code),
  };
}

/** Where a fault is logged and how its log line is named. */
export interface FaultContext {
  readonly ids: IdSource;
  readonly logger: Logger;
}

/**
 * The error of a `fail` frame for a call that threw. A `BinferenceError` with a protocol code keeps
 * it. Anything else is logged and becomes `internal.error` with `details.ref`, the log line's
 * trace id; its message and details stay in the log.
 */
export function faultFailure(fault: Error | undefined, context: FaultContext): ProtocolError {
  if (fault instanceof BinferenceError && protocolCodes.has(fault.code)) {
    const details = Object.keys(fault.details).length === 0 ? {} : { details: fault.details };
    return { code: fault.code, message: fault.message, retryable: fault.retryable, ...details };
  }
  const ref = context.ids.next("ref");
  context.logger.error("server.call_failed", {
    traceId: ref,
    errorCode: fault instanceof BinferenceError ? fault.code : "unexpected",
  });
  return {
    code: "internal.error",
    message: "The engine failed to answer this call.",
    retryable: false,
    details: { ref },
  };
}
