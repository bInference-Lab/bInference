import assert from "node:assert/strict";
import { BinferenceError, type Ratio } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { CandleRequest, MarketCandle } from "../market/market-candle.js";
import type { MarketDataSource } from "../market/ports.js";
import type { MarketDataSourceHarness } from "./market-data-source-contract.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

// The source's candle read, which a source under this contract must have.
function candlesOf(source: MarketDataSource): NonNullable<MarketDataSource["candles"]> {
  const { candles } = source;
  assert.ok(candles !== undefined, `${source.id} reads no candles`);
  return candles;
}

// Whether `left` is at most `right`, compared exactly.
const atMost = (left: Ratio, right: Ratio): boolean =>
  left.numerator * right.denominator <= right.numerator * left.denominator;

function assertCandle(candle: MarketCandle, request: CandleRequest): void {
  for (const price of [candle.open, candle.high, candle.low, candle.close]) {
    assert.ok(price.numerator >= 0n && price.denominator > 0n);
  }
  assert.ok(atMost(candle.low, candle.open) && atMost(candle.open, candle.high));
  assert.ok(atMost(candle.low, candle.close) && atMost(candle.close, candle.high));
  assert.ok(candle.volumeUsdMicros >= 0n);
  assert.ok(candle.atMs >= 0 && candle.atMs % 1 === 0);
  assert.ok(request.beforeMs === undefined || candle.atMs < request.beforeMs);
}

const request: CandleRequest = { interval: "4h", limit: 3 };

const readChecks = (harness: MarketDataSourceHarness): readonly ContractCheck[] => [
  {
    name: "reads a known token's candles oldest first, within the limit, each a candle",
    run: async () => {
      const { source, known } = harness.create();
      const candles = await candlesOf(source)(known, request, live());
      assert.ok(candles.ok);
      assert.ok(candles.value.length > 0 && candles.value.length <= request.limit);
      const starts = candles.value.map((candle) => candle.atMs);
      assert.deepEqual(
        starts,
        [...new Set(starts)].toSorted((left, right) => left - right),
      );
      for (const candle of candles.value) {
        assertCandle(candle, request);
      }
    },
  },
  {
    name: "reads no candles of a token it knows nothing of",
    run: async () => {
      const { source, unknown } = harness.create();
      assert.deepEqual(await candlesOf(source)(unknown, request, live()), {
        ok: true,
        value: [],
      });
    },
  },
];

const refusalChecks = (harness: MarketDataSourceHarness): readonly ContractCheck[] => [
  {
    name: "answers not_covered for candles on a chain it does not serve",
    run: async () => {
      const { source, uncovered } = harness.create();
      const expected = { ok: false, error: "not_covered" };
      assert.deepEqual(await candlesOf(source)(uncovered, request, live()), expected);
    },
  },
  {
    name: "rejects a candle read with a binference error when its service is down",
    run: async () => {
      const { down, known } = harness.create();
      await assert.rejects(candlesOf(down)(known, request, live()), BinferenceError);
    },
  },
  {
    name: "rejects a candle read with the signal's reason once the signal aborts",
    run: async () => {
      const { source, known } = harness.create();
      const controller = new AbortController();
      const reason = new Error("stopped");
      controller.abort(reason);
      const read = candlesOf(source)(known, request, { signal: controller.signal });
      await assert.rejects(read, reason);
    },
  },
];

/**
 * The contract of a `MarketDataSource` that reads candles, run beside
 * `marketDataSourceContract`: the harness's known token has candles at the four-hour interval.
 */
export function marketCandlesContract(harness: MarketDataSourceHarness): readonly ContractCheck[] {
  return [...readChecks(harness), ...refusalChecks(harness)];
}
