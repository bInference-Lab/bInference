import assert from "node:assert/strict";
import type { Random } from "../ports.js";
import type { ContractCheck } from "./contract-check.js";

/** Makes a fresh `Random` for each check. */
export interface RandomHarness {
  create(): Random;
}

/** The contract every `Random` adapter passes. */
export function randomContract(harness: RandomHarness): readonly ContractCheck[] {
  return [
    {
      name: "gives as many bytes as asked",
      run: async () => {
        const random = harness.create();
        assert.equal(random.bytes(0).length, 0);
        assert.equal(random.bytes(32).length, 32);
        await Promise.resolve();
      },
    },
    {
      name: "gives different bytes on each draw",
      run: async () => {
        const random = harness.create();
        assert.notDeepEqual(random.bytes(32), random.bytes(32));
        await Promise.resolve();
      },
    },
  ];
}
