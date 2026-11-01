import type { Id } from "@binference/core";
import { inboxMessageViewSchema } from "@binference/protocol";
import type { ExecutorBench } from "./test-executor.js";

/** The settle messages the bench's engine pushed to the agent runtime, as intent and state. */
export function settlesOf(bench: ExecutorBench): readonly (readonly [Id<"int">, string])[] {
  return bench.test.pushes
    .filter((push) => push.topic === "inbox")
    .map((push) => inboxMessageViewSchema.parse(push.data))
    .flatMap((view) =>
      view.kind === "inbox/intentSettled" ? [[view.intent.intent, view.intent.state] as const] : [],
    );
}
