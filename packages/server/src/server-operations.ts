import type { JsonValue } from "@binference/core";
import {
  type ArgsOf,
  describeOperations,
  type EngineFrame,
  type OperationCall,
  operations,
  type ProtocolError,
} from "@binference/protocol";
import { encodeResult } from "./encode-result.js";
import type { PushHub, PushSubscriber } from "./push-hub.js";

/** What the operations the server answers itself work on. */
export interface ServerOperations {
  readonly pushes: PushHub;
  /** The `engine/describe` answer, encoded once: it never changes while the server runs. */
  readonly description: () => JsonValue;
}

/** One call of an operation the server answers itself. */
export interface ServerCall {
  /** The call frame's id. */
  readonly id: string;
  readonly call: OperationCall;
  readonly subscriber: PushSubscriber;
}

const refusals: Readonly<Record<"scope" | "busy", ProtocolError>> = {
  scope: {
    code: "auth.scope",
    message: "A topic needs a scope this connection does not hold.",
    retryable: false,
  },
  busy: {
    code: "protocol.busy",
    message: "This connection subscribes to too many topics.",
    retryable: false,
  },
};

function subscribe(
  request: ServerCall,
  args: ArgsOf<"push/subscribe">,
  pushes: PushHub,
): EngineFrame[] {
  const subscribed = pushes.subscribe(request.subscriber, args.topics);
  if (!subscribed.ok) {
    return [{ t: "fail", id: request.id, error: refusals[subscribed.error] }];
  }
  const result = encodeResult(operations["push/subscribe"], subscribed.value.view);
  return [{ t: "reply", id: request.id, result }, ...subscribed.value.replay];
}

/**
 * Builds the `engine/describe` answer once, on first use: every operation with its scope, flags,
 * `since` and the JSON Schemas of its args and result.
 */
export function describeOnce(): () => JsonValue {
  let description: JsonValue | undefined;
  return () => {
    description ??= encodeResult(operations["engine/describe"], describeOperations());
    return description;
  };
}

/**
 * Answers `push/subscribe`, `push/unsubscribe` and `engine/describe` at once, with the frames to
 * send in order: a subscription's reply comes before the pushes it replays, and nothing runs
 * between them, so no other push lands in between. Returns `undefined` for any other operation.
 */
export function answerServerCall(
  request: ServerCall,
  server: ServerOperations,
): readonly EngineFrame[] | undefined {
  const { call, id } = request;
  if (call.op === "push/subscribe") {
    return subscribe(request, call.args, server.pushes);
  }
  if (call.op === "push/unsubscribe") {
    server.pushes.unsubscribe(request.subscriber.id, call.args.topics);
    return [{ t: "reply", id, result: encodeResult(operations["push/unsubscribe"], {}) }];
  }
  if (call.op === "engine/describe") {
    return [{ t: "reply", id, result: server.description() }];
  }
  return undefined;
}
