import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type ChainRef, chainRefParts } from "../caip/chain-ref.js";
import type { ChainRegistry } from "../ports.js";

/** A registry under test, a chain it holds and one it does not. */
export interface ChainRegistrySubject {
  readonly registry: ChainRegistry;
  readonly known: ChainRef;
  readonly unknown: ChainRef;
}

/** Makes a fresh {@link ChainRegistrySubject} for each check. */
export interface ChainRegistryHarness {
  create(): ChainRegistrySubject;
}

/** The contract every `ChainRegistry` passes. */
export function chainRegistryContract(harness: ChainRegistryHarness): readonly ContractCheck[] {
  return [
    {
      name: "gives a chain it holds with the family of its namespace",
      run: async () => {
        const { registry, known } = harness.create();
        const found = registry.get(known);
        assert.ok(found.ok);
        assert.equal(found.value.ref, known);
        assert.equal(found.value.family.namespace, chainRefParts(known).namespace);
        assert.equal(found.value.signingScheme.family, found.value.family.id);
        await Promise.resolve();
      },
    },
    {
      name: "answers an unknown chain as an expected failure",
      run: async () => {
        const { registry, unknown } = harness.create();
        assert.deepEqual(registry.get(unknown), { ok: false, error: "unknown_chain" });
        await Promise.resolve();
      },
    },
    {
      name: "lists every chain it holds",
      run: async () => {
        const { registry, known } = harness.create();
        assert.ok(registry.list().some((chain) => chain.ref === known));
        await Promise.resolve();
      },
    },
  ];
}
