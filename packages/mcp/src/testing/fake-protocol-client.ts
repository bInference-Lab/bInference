import type { CallableName, ClientStatus, ProtocolClient } from "@binference/client";
import {
  type OperationShapes,
  operations,
  protocolVersion,
  type ReadyFrame,
  readyFrameSchema,
  type ResultOf,
} from "@binference/protocol";
import { z } from "zod";

/** What the fake engine answers each operation with: a result, or an error to throw. */
export type FakeAnswers = {
  readonly [N in CallableName<OperationShapes>]?: ResultOf<N> | Error;
};

/** One call that reached the fake engine, with its args as JSON carries them and its key. */
interface FakeCall {
  readonly op: string;
  readonly args: string;
  /** The idempotency key the caller passed, if it passed one. */
  readonly key?: string;
}

/** A protocol client over a fake engine that records every call it receives. */
export interface FakeProtocolClient extends ProtocolClient {
  readonly calls: readonly FakeCall[];
}

/** An error as the protocol client throws it: a dotted code and the engine's message. */
export function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const ready: ReadyFrame = readyFrameSchema.parse({
  t: "ready",
  v: protocolVersion,
  connection: "con_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
  scopes: ["read", "propose"],
  engine: { version: "2026.10.0", protocol: protocolVersion, state: "ready" },
  owner: { locale: "en", timezone: "UTC" },
});

/**
 * A protocol client whose engine answers from `answers` and fails any other operation with
 * `protocol.unknown_op`. Like the real client, it encodes each call's args with the operation's
 * schema and refuses calls once closed. With `refusal`, connecting fails with it for good.
 */
export function createFakeProtocolClient(
  answers: FakeAnswers,
  refusal?: Error,
): FakeProtocolClient {
  const calls: FakeCall[] = [];
  let status: ClientStatus = { state: "idle" };
  return {
    calls,
    connect: async () => {
      if (refusal !== undefined) {
        status = { state: "closed", error: refusal };
        throw refusal;
      }
      status = { state: "ready", ready };
      return ready;
    },
    async call(op, args, options) {
      if (status.state === "closed") {
        throw status.error;
      }
      const wire = z.encode<z.ZodType<OperationShapes[typeof op]["args"]>>(
        operations[op].args,
        args,
      );
      const key = options.key === undefined ? {} : { key: options.key };
      calls.push({ op, args: JSON.stringify(wire), ...key });
      const answer = answers[op];
      if (answer === undefined) {
        throw codedError("protocol.unknown_op", `The fake engine has no answer for ${op}.`);
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    subscribe: () => () => undefined,
    status: () => status,
    close: () => {
      status = { state: "closed", error: codedError("client.closed", "The client is closed.") };
    },
  };
}
