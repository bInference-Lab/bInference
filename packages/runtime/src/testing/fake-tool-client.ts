import type { CallableName } from "@binference/client";
import { BinferenceError, type JsonValue, jsonValueSchema } from "@binference/core";
import { type OperationShapes, operations } from "@binference/protocol";
import type { ToolClient } from "../tools/tool-client.js";

/** An operation the fake answers: any operation a tool may call. */
type ToolOperation = CallableName<OperationShapes>;

/** One call the fake took: the operation, its args as the client would send them, and its key. */
interface TakenCall {
  readonly op: ToolOperation;
  readonly args: JsonValue;
  readonly key?: string;
}

/** What the fake answers an operation with: its result as JSON carries it, or an error to throw. */
export type FakeAnswer = JsonValue | Error;

/** A {@link ToolClient} for tests, which records each call and answers from its table. */
export interface FakeToolClient extends ToolClient {
  /** Every call, oldest first. */
  calls(): readonly TakenCall[];
}

/**
 * Creates a fake {@link ToolClient}. Each operation answers from `answers`: an error is thrown, and
 * JSON is parsed by the operation's result schema, as the real client does. An operation with no
 * answer fails `protocol.unknown_op`. Args are recorded as JSON, amounts as decimal strings.
 */
export function createFakeToolClient(
  answers: Partial<Readonly<Record<ToolOperation, FakeAnswer>>>,
): FakeToolClient {
  const taken: TakenCall[] = [];
  return {
    calls: () => [...taken],
    async call(op, args, options) {
      const operation = operations[op];
      const wire = jsonValueSchema.parse(JSON.parse(JSON.stringify(operation.args.encode(args))));
      taken.push({ op, args: wire, ...(options.key === undefined ? {} : { key: options.key }) });
      const answer = answers[op];
      if (answer instanceof Error) {
        throw answer;
      }
      if (answer === undefined) {
        throw new BinferenceError({
          code: "protocol.unknown_op",
          message: `The fake answers no ${op}.`,
        });
      }
      return operation.result.parse(answer);
    },
  };
}
