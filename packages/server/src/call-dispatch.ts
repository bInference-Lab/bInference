import {
  type CallFrame,
  type CallProblem,
  type EngineFrame,
  type FailFrame,
  isOperationName,
  type Operation,
  type OperationName,
  operations,
  parseCall,
  type ProtocolError,
  takesOwnerKey,
  type ReplyFrame,
  type Scope,
} from "@binference/protocol";
import type { EngineFacts } from "./engine-facts.js";
import type { Caller } from "./operation-handlers.js";
import type { PushSubscriber } from "./push-hub.js";
import { type RunContext, runHandler } from "./run-handler.js";
import { answerServerCall, type ServerOperations } from "./server-operations.js";

/** A signed-in connection as calls see it. */
export interface Session {
  readonly caller: Caller;
  readonly subscriber: PushSubscriber;
  /** Aborts when the connection closes. */
  readonly closed: AbortSignal;
}

/** What a call became: answered at once, with the frames to send in order, or running. */
export type CallStep =
  | { readonly kind: "answered"; readonly frames: readonly EngineFrame[] }
  | { readonly kind: "running"; readonly answer: Promise<ReplyFrame | FailFrame> };

/** Checks and routes one call of a signed-in connection. */
export type CallDispatch = (frame: CallFrame, session: Session) => CallStep;

/** What the dispatch routes calls to. */
export interface CallDispatchOptions extends RunContext, ServerOperations {
  readonly engine: EngineFacts;
}

const serverOperations: ReadonlySet<string> = new Set([
  "push/subscribe",
  "push/unsubscribe",
  "engine/describe",
]);

// Subscribing must work while starting: the push that announces readiness arrives on a topic.
const servedWhileStarting: ReadonlySet<string> = new Set([
  "engine/status",
  "push/subscribe",
  "push/unsubscribe",
]);

const problemMessages: Readonly<Record<CallProblem, string>> = {
  "protocol.unknown_op": "The protocol has no such operation.",
  "protocol.key_required": "A write needs an idempotency key.",
  "protocol.bad_args": "The args break the operation's schema.",
};

function refused(code: ProtocolError["code"], message: string): ProtocolError {
  return { code, message, retryable: false };
}

function retryLater(code: ProtocolError["code"], message: string): ProtocolError {
  return { code, message, retryable: true };
}

function holdsScope(scopes: readonly Scope[], operation: Operation): boolean {
  const caseScope = operation.scopeCase?.scope;
  return (
    scopes.includes(operation.scope) || (caseScope !== undefined && scopes.includes(caseScope))
  );
}

function noHandler(operation: Operation): ProtocolError {
  return operation.answeredBy === "runtime"
    ? retryLater("runtime.unavailable", "The agent runtime is not connected.")
    : refused("protocol.unknown_op", `This engine does not serve ${operation.name}.`);
}

/**
 * Whether a call of the operation needs a shell on the machine: its row marks it `ipc`, or its
 * args carry the owner key, whatever its row says. Such a call runs over IPC only.
 */
export function isLocalOnly(operation: Pick<Operation, "transport" | "args">): boolean {
  return operation.transport === "ipc" || takesOwnerKey(operation);
}

function refusalOf(
  op: OperationName,
  caller: Caller,
  options: CallDispatchOptions,
): ProtocolError | undefined {
  const operation = operations[op];
  if (!holdsScope(caller.scopes, operation)) {
    return refused("auth.scope", `${op} needs the ${operation.scope} scope.`);
  }
  // Any transport but IPC is refused, so a transport added later is refused too.
  if (isLocalOnly(operation) && caller.transport !== "ipc") {
    return refused("auth.local_only", `${op} works over local IPC only.`);
  }
  if (options.engine.state() === "starting" && !servedWhileStarting.has(op)) {
    return retryLater("engine.starting", "The engine is starting.");
  }
  if (!serverOperations.has(op) && options.handlers[op] === undefined) {
    return noHandler(operation);
  }
  return undefined;
}

/**
 * Creates the call dispatch. In order, a call fails for an unknown operation
 * (`protocol.unknown_op`), a scope the connection lacks, counting the operation's scope case
 * (`auth.scope`), a local operation or one that carries the owner key over any transport but IPC
 * (`auth.local_only`), an engine still starting (`engine.starting`), a missing handler, a write
 * without a key or args the schema refuses. The server's own operations are answered at once;
 * every other call runs its handler.
 */
export function createCallDispatch(options: CallDispatchOptions): CallDispatch {
  return (frame, session) => {
    const fail = (error: ProtocolError): CallStep => ({
      kind: "answered",
      frames: [{ t: "fail", id: frame.id, error }],
    });
    if (!isOperationName(frame.op)) {
      return fail(refused("protocol.unknown_op", problemMessages["protocol.unknown_op"]));
    }
    const refusal = refusalOf(frame.op, session.caller, options);
    if (refusal !== undefined) {
      return fail(refusal);
    }
    const parsed = parseCall(frame);
    if (!parsed.ok) {
      return fail(refused(parsed.error, problemMessages[parsed.error]));
    }
    const request = { id: frame.id, call: parsed.value, subscriber: session.subscriber };
    const frames = answerServerCall(request, options);
    if (frames !== undefined) {
      return { kind: "answered", frames };
    }
    const run = { frame, call: parsed.value, caller: session.caller, closed: session.closed };
    return { kind: "running", answer: runHandler(run, options) };
  };
}
