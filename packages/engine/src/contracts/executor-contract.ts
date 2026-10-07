import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { Executor } from "../ports.js";

/** An executor under test, and a confirmed live intent its store holds. */
export interface ExecutorSubject {
  readonly executor: Executor;
  readonly intent: Id<"int">;
}

/** Makes a fresh {@link ExecutorSubject} for each check. */
export interface ExecutorHarness {
  create(): Promise<ExecutorSubject>;
}

/** The contract every `Executor` adapter passes. */
export function executorContract(harness: ExecutorHarness): readonly ContractCheck[] {
  return [
    {
      name: "takes a confirmed live intent it is handed",
      run: async () => {
        const { executor, intent } = await harness.create();
        await executor.take(intent, { signal: new AbortController().signal });
      },
    },
    {
      name: "refuses to take an intent on an aborted signal",
      run: async () => {
        const { executor, intent } = await harness.create();
        const reason = new Error("stopped");
        await assert.rejects(executor.take(intent, { signal: AbortSignal.abort(reason) }), reason);
      },
    },
  ];
}
