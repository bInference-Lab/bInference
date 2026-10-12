import assert from "node:assert/strict";
import { type AssetRef, assetRefParts } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { MarketReads } from "../market/ports.js";

/** Market reads under test, with what their sources know and what they do not. */
export interface MarketReadsSubject {
  readonly reads: MarketReads;
  /** A token some source knows pools and four-hour candles of, on a chain with trending tokens. */
  readonly known: AssetRef;
  /** A token no source knows anything of. */
  readonly unknown: AssetRef;
  /** The same reads over sources that are all down. */
  readonly down: MarketReads;
}

/** Makes a fresh {@link MarketReadsSubject} for each check. */
export interface MarketReadsHarness {
  create(): MarketReadsSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const fourHours = { interval: "4h", limit: 3 } as const;

const answerChecks = (harness: MarketReadsHarness): readonly ContractCheck[] => [
  {
    name: "reads a known token's pools and its chain's trending tokens, naming the source",
    run: async () => {
      const { reads, known } = harness.create();
      const pools = await reads.pools(known, live());
      const trending = await reads.trending(assetRefParts(known).chain, live());
      assert.ok(pools.ok && trending.ok);
      assert.ok(pools.value.items.length > 0 && trending.value.items.length > 0);
      assert.match(pools.value.source, /^[a-z][a-z0-9-]{0,31}$/);
      assert.match(trending.value.source, /^[a-z][a-z0-9-]{0,31}$/);
    },
  },
  {
    name: "reads a known token's candles oldest first, within the limit, naming the source",
    run: async () => {
      const { reads, known } = harness.create();
      const chart = await reads.chart(known, fourHours, live());
      assert.ok(chart.ok && chart.value.items.length > 0);
      assert.ok(chart.value.items.length <= fourHours.limit);
      const starts = chart.value.items.map((candle) => candle.atMs);
      assert.deepEqual(
        starts,
        starts.toSorted((left, right) => left - right),
      );
      assert.match(chart.value.source, /^[a-z][a-z0-9-]{0,31}$/);
    },
  },
];

const refusalChecks = (harness: MarketReadsHarness): readonly ContractCheck[] => [
  {
    name: "answers no_data for the pools and chart of a token no source knows anything of",
    run: async () => {
      const { reads, unknown } = harness.create();
      const expected = { ok: false, error: "no_data" };
      assert.deepEqual(await reads.pools(unknown, live()), expected);
      assert.deepEqual(await reads.chart(unknown, fourHours, live()), expected);
    },
  },
  {
    name: "answers source_down when the sources are down",
    run: async () => {
      const { down, known } = harness.create();
      const expected = { ok: false, error: "source_down" };
      assert.deepEqual(await down.pools(known, live()), expected);
      assert.deepEqual(await down.trending(assetRefParts(known).chain, live()), expected);
      assert.deepEqual(await down.chart(known, fourHours, live()), expected);
    },
  },
  {
    name: "rejects with the signal's reason once the signal aborts",
    run: async () => {
      const { reads, known } = harness.create();
      const controller = new AbortController();
      const reason = new Error("stopped");
      controller.abort(reason);
      await assert.rejects(reads.pools(known, { signal: controller.signal }), reason);
      await assert.rejects(
        reads.trending(assetRefParts(known).chain, { signal: controller.signal }),
        reason,
      );
      await assert.rejects(reads.chart(known, fourHours, { signal: controller.signal }), reason);
    },
  },
];

/** The contract every `MarketReads` adapter passes. */
export function marketReadsContract(harness: MarketReadsHarness): readonly ContractCheck[] {
  return [...answerChecks(harness), ...refusalChecks(harness)];
}
