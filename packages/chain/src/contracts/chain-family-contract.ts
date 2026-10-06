import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { ChainFamily } from "../ports.js";

/** An address as written, and the canonical form its family gives it. */
export interface AddressSample {
  readonly text: string;
  readonly canonical: string;
}

/** A family under test, with addresses it must accept and texts it must refuse. */
export interface ChainFamilySubject {
  readonly family: ChainFamily;
  readonly addresses: readonly AddressSample[];
  readonly malformed: readonly string[];
}

/** Makes a fresh {@link ChainFamilySubject} for each check. */
export interface ChainFamilyHarness {
  create(): ChainFamilySubject;
}

/** The contract every `ChainFamily` passes. */
export function chainFamilyContract(harness: ChainFamilyHarness): readonly ContractCheck[] {
  return [
    {
      name: "names its id and a CAIP-2 namespace",
      run: async () => {
        const { family } = harness.create();
        assert.match(family.id, /^[a-z][a-z0-9-]*$/);
        assert.match(family.namespace, /^[-a-z0-9]{3,8}$/);
        await Promise.resolve();
      },
    },
    {
      name: "gives the canonical form of every address it accepts",
      run: async () => {
        const { family, addresses } = harness.create();
        assert.ok(addresses.length > 0);
        for (const { text, canonical } of addresses) {
          assert.deepEqual(family.parseAddress(text), { ok: true, value: canonical });
          assert.deepEqual(family.parseAddress(canonical), { ok: true, value: canonical });
        }
        await Promise.resolve();
      },
    },
    {
      name: "refuses malformed text as an expected failure",
      run: async () => {
        const { family, malformed } = harness.create();
        assert.ok(malformed.length > 0);
        for (const text of malformed) {
          assert.deepEqual(family.parseAddress(text), { ok: false, error: "malformed_address" });
        }
        await Promise.resolve();
      },
    },
  ];
}
