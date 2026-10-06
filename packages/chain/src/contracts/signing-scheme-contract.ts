import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { SigningScheme } from "../ports.js";
import type { SignedTx, UnsignedTx } from "../transaction.js";

/** A signing scheme under test, with one transaction signed four ways. */
export interface SigningSchemeSubject {
  readonly scheme: SigningScheme;
  readonly unsigned: UnsignedTx;
  /** The transaction, signed by its sender. */
  readonly signed: SignedTx;
  /** The same transaction, signed by another account. */
  readonly signedByOther: SignedTx;
  /** Another transaction, signed by the sender. */
  readonly otherSigned: SignedTx;
  /** Bytes that are no signed transaction at all. */
  readonly malformed: SignedTx;
}

/** Makes a fresh {@link SigningSchemeSubject} for each check. */
export interface SigningSchemeHarness {
  create(): SigningSchemeSubject;
}

/** The contract every `SigningScheme` passes. */
export function signingSchemeContract(harness: SigningSchemeHarness): readonly ContractCheck[] {
  return [
    {
      name: "accepts the transaction signed by its sender and gives a stable hash",
      run: async () => {
        const { scheme, unsigned, signed } = harness.create();
        const first = scheme.verify(unsigned, signed);
        assert.ok(first.ok);
        assert.deepEqual(scheme.verify(unsigned, signed), first);
        await Promise.resolve();
      },
    },
    {
      name: "refuses a signature by another account",
      run: async () => {
        const { scheme, unsigned, signedByOther } = harness.create();
        assert.deepEqual(scheme.verify(unsigned, signedByOther), {
          ok: false,
          error: "other_signer",
        });
        await Promise.resolve();
      },
    },
    {
      name: "refuses a signed transaction that is not the one asked for",
      run: async () => {
        const { scheme, unsigned, otherSigned } = harness.create();
        assert.deepEqual(scheme.verify(unsigned, otherSigned), {
          ok: false,
          error: "other_transaction",
        });
        await Promise.resolve();
      },
    },
    {
      name: "refuses bytes that are no signed transaction",
      run: async () => {
        const { scheme, unsigned, malformed } = harness.create();
        assert.deepEqual(scheme.verify(unsigned, malformed), {
          ok: false,
          error: "malformed_signature",
        });
        await Promise.resolve();
      },
    },
  ];
}
