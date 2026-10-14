import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { accountRefParts } from "../caip/account-ref.js";
import { assetRefParts } from "../caip/asset-ref.js";
import type { CurveRequest } from "../venues/curve-holding.js";
import type { InsiderReader } from "../venues/ports.js";

/** A launchpad under test, a token it launched with insiders, and one it did not launch. */
export interface InsiderReaderSubject {
  readonly reader: InsiderReader;
  /** A token it launched, whose launch favored at least one wallet. */
  readonly launched: CurveRequest;
  /** A token it never launched. */
  readonly other: CurveRequest;
}

/** Makes a fresh {@link InsiderReaderSubject} for each check. */
export interface InsiderReaderHarness {
  create(): InsiderReaderSubject;
}

const live = (): AbortSignal => new AbortController().signal;

/** The contract every `InsiderReader` passes. */
export function insiderReaderContract(harness: InsiderReaderHarness): readonly ContractCheck[] {
  return [
    {
      name: "names the insiders of a token it launched as accounts of its chain, each once",
      run: async () => {
        const { reader, launched } = harness.create();
        const insiders = await reader.insiders(launched, { signal: live() });
        const chain = assetRefParts(launched.token).chain;
        assert.ok(insiders.length > 0);
        assert.equal(new Set(insiders).size, insiders.length);
        for (const insider of insiders) {
          assert.equal(accountRefParts(insider).chain, chain);
        }
      },
    },
    {
      name: "names no insider of a token it did not launch",
      run: async () => {
        const { reader, other } = harness.create();
        assert.deepEqual(await reader.insiders(other, { signal: live() }), []);
      },
    },
    {
      name: "refuses to read on an aborted signal",
      run: async () => {
        const { reader, launched } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(
          reader.insiders(launched, { signal: AbortSignal.abort(reason) }),
          reason,
        );
      },
    },
  ];
}
