import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { WriterFence } from "../ports.js";
import { go, rejectsAborted } from "./agent-fixtures.js";

/** Makes a fresh writer fence on an empty agent database for each check. */
export interface WriterFenceHarness {
  create(): Promise<WriterFence>;
}

/** The contract every `WriterFence` adapter passes. */
export function writerFenceContract(harness: WriterFenceHarness): readonly ContractCheck[] {
  return [
    {
      name: "raises the fence from 1, one more at each raise",
      run: async () => {
        const fence = await harness.create();
        assert.deepEqual(
          [await fence.raise(go()), await fence.raise(go()), await fence.raise(go())],
          [1, 2, 3],
        );
      },
    },
    {
      name: "refuses a raise on an aborted signal and raises nothing",
      run: async () => {
        const fence = await harness.create();
        await rejectsAborted(async (options) => fence.raise(options));
        assert.equal(await fence.raise(go()), 1);
      },
    },
  ];
}
