import assert from "node:assert/strict";
import type { AssetRef } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { PriceSource } from "../ports.js";

/** A price source under test, an asset it prices and one it cannot price. */
export interface PriceSourceSubject {
  readonly source: PriceSource;
  readonly known: AssetRef;
  readonly unknown: AssetRef;
}

/** Makes a fresh {@link PriceSourceSubject} for each check. */
export interface PriceSourceHarness {
  create(): PriceSourceSubject;
}

const live = (): AbortSignal => new AbortController().signal;

/** The contract every `PriceSource` adapter passes. */
export function priceSourceContract(harness: PriceSourceHarness): readonly ContractCheck[] {
  return [
    {
      name: "prices an asset it knows above zero",
      run: async () => {
        const { source, known } = harness.create();
        const price = await source.usdPrice(known, { signal: live() });
        assert.ok(price.ok);
        assert.ok(price.value.numerator > 0n);
        assert.ok(price.value.denominator > 0n);
      },
    },
    {
      name: "answers an asset it cannot price as no price",
      run: async () => {
        const { source, unknown } = harness.create();
        const price = await source.usdPrice(unknown, { signal: live() });
        assert.deepEqual(price, { ok: false, error: "no_price" });
      },
    },
    {
      name: "refuses to price on an aborted signal",
      run: async () => {
        const { source, known } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(source.usdPrice(known, { signal: AbortSignal.abort(reason) }), reason);
      },
    },
  ];
}
