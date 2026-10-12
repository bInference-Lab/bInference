import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { assetRefParts } from "../caip/asset-ref.js";
import { type CurveRequest, curveHoldingSchema } from "../venues/curve-holding.js";
import type { CurveReader } from "../venues/ports.js";

/** A launchpad under test, a token on its curve and one that is not. */
export interface CurveReaderSubject {
  readonly reader: CurveReader;
  /** A token the launchpad holds on its curve. */
  readonly onCurve: CurveRequest;
  /** A token the launchpad does not hold: never launched there, or graduated. */
  readonly offCurve: CurveRequest;
}

/** Makes a fresh {@link CurveReaderSubject} for each check. */
export interface CurveReaderHarness {
  create(): CurveReaderSubject;
}

const live = (): AbortSignal => new AbortController().signal;

/** The contract every `CurveReader` passes. */
export function curveReaderContract(harness: CurveReaderHarness): readonly ContractCheck[] {
  return [
    {
      name: "names the asset a token on its curve trades against, on the token's chain",
      run: async () => {
        const { reader, onCurve } = harness.create();
        const holding = await reader.curve(onCurve, { signal: live() });
        assert.ok(holding.onCurve);
        assert.ok(curveHoldingSchema.safeEncode(holding).success);
        const chain = assetRefParts(onCurve.token).chain;
        assert.equal(assetRefParts(holding.quoteAsset).chain, chain);
        assert.notEqual(holding.quoteAsset, onCurve.token);
      },
    },
    {
      name: "answers a token it does not hold as off its curve",
      run: async () => {
        const { reader, offCurve } = harness.create();
        assert.deepEqual(await reader.curve(offCurve, { signal: live() }), { onCurve: false });
      },
    },
    {
      name: "refuses to read on an aborted signal",
      run: async () => {
        const { reader, onCurve } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(reader.curve(onCurve, { signal: AbortSignal.abort(reason) }), reason);
      },
    },
  ];
}
