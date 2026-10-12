import assert from "node:assert/strict";
import { BinferenceError } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { assetRefParts } from "../caip/asset-ref.js";
import type { MarketDataSource } from "../market/ports.js";
import type { MarketDataSourceHarness } from "./market-data-source-contract.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

// The source's price read, which a source under this contract must have.
function pricesOf(source: MarketDataSource): NonNullable<MarketDataSource["prices"]> {
  const { prices } = source;
  assert.ok(prices !== undefined, `${source.id} reads no prices`);
  return prices;
}

/**
 * The contract of a `MarketDataSource` that reads token prices for the price watcher's
 * cross-check, run beside `marketDataSourceContract`: the harness's known token has a price.
 */
export function marketPricesContract(harness: MarketDataSourceHarness): readonly ContractCheck[] {
  return [
    {
      name: "prices a known token above zero and leaves out a token it knows nothing of",
      run: async () => {
        const { source, known, unknown } = harness.create();
        const { chain } = assetRefParts(known);
        const prices = await pricesOf(source)(chain, [known, unknown], live());
        assert.ok(prices.ok);
        assert.deepEqual([...prices.value.keys()], [known]);
        const price = prices.value.get(known);
        assert.ok(price !== undefined && price.numerator > 0n && price.denominator > 0n);
      },
    },
    {
      name: "answers not_covered for prices on a chain it does not serve",
      run: async () => {
        const { source, uncovered } = harness.create();
        const { chain } = assetRefParts(uncovered);
        const expected = { ok: false, error: "not_covered" };
        assert.deepEqual(await pricesOf(source)(chain, [uncovered], live()), expected);
      },
    },
    {
      name: "rejects a price read with a binference error when its service is down",
      run: async () => {
        const { down, known } = harness.create();
        const { chain } = assetRefParts(known);
        await assert.rejects(pricesOf(down)(chain, [known], live()), BinferenceError);
      },
    },
    {
      name: "rejects a price read with the signal's reason once the signal aborts",
      run: async () => {
        const { source, known } = harness.create();
        const controller = new AbortController();
        const reason = new Error("stopped");
        controller.abort(reason);
        const { chain } = assetRefParts(known);
        await assert.rejects(
          pricesOf(source)(chain, [known], { signal: controller.signal }),
          reason,
        );
      },
    },
  ];
}
