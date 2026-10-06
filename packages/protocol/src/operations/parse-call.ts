import { err, ok, type Result } from "@binference/core";
import type { CallFrame } from "../frames/call-frame.schema.js";
import { type ArgsOf, isOperationName, type OperationName, operations } from "./operations.js";

/** A call of operation `N` whose key and args passed its schema. */
export interface CallOf<N extends OperationName> {
  readonly op: N;
  readonly args: ArgsOf<N>;
  /** The idempotency key; every write carries one. */
  readonly key?: string;
}

// Mapping over the type parameter lets the compiler see `CallOf<N>` as a member for a generic N.
type CallUnion<N extends OperationName> = { readonly [P in N]: CallOf<P> }[N];

/** A checked call of any operation; `op` tells which, and narrows `args`. */
export type OperationCall = CallUnion<OperationName>;

/**
 * Why a call fails before the engine runs it: an operation the protocol does not have, a write
 * without an idempotency key, or args its schema refuses.
 */
export type CallProblem = "protocol.unknown_op" | "protocol.key_required" | "protocol.bad_args";

function parseKnownCall<N extends OperationName>(
  op: N,
  frame: CallFrame,
): Result<CallUnion<N>, CallProblem> {
  const operation = operations[op];
  if (operation.idempotency === "key" && frame.key === undefined) {
    return err("protocol.key_required");
  }
  const args = operation.args.safeParse(frame.args);
  if (!args.success) {
    return err("protocol.bad_args");
  }
  const call: CallOf<N> = {
    op,
    args: args.data,
    ...(frame.key === undefined ? {} : { key: frame.key }),
  };
  return ok(call);
}

/**
 * Checks a `call` frame against its operation: the operation exists, a write carries `key`, and
 * the args pass the operation's schema, which refuses unknown fields. Scopes and the transport
 * are the server's to check, since they depend on the connection.
 */
export function parseCall(frame: CallFrame): Result<OperationCall, CallProblem> {
  return isOperationName(frame.op) ? parseKnownCall(frame.op, frame) : err("protocol.unknown_op");
}
