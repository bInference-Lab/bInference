import assert from "node:assert/strict";
import { BinferenceError } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { type AssetRef, assetRefParts } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { MarketPool } from "../market/market-pool.js";
import type { MarketDataSource } from "../market/ports.js";

/** A market data source under test, with what it knows and what it does not serve. */
export interface MarketDataSourceSubject {
  readonly source: MarketDataSource;
  /** A token on a chain the source serves, with at least one pool. */
  readonly known: AssetRef;
  /** A token on that chain that the source knows no pool of. */
  readonly unknown: AssetRef;
  /** A token on a chain the source does not serve. */
  readonly uncovered: AssetRef;
  /** The same source over a service that is down. */
  readonly down: MarketDataSource;
}

/** Makes a fresh {@link MarketDataSourceSubject} for each check. */
export interface MarketDataSourceHarness {
  create(): MarketDataSourceSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

const chainOf = (asset: AssetRef): ChainRef => assetRefParts(asset).chain;

// Orders depths from the deepest down.
function deeperFirst(left: bigint, right: bigint): number {
  if (left > right) {
    return -1;
  }
  return left < right ? 1 : 0;
}

// A pool as the port promises it: of the token asked about, on its chain, figures not negative.
function assertPoolOf(pool: MarketPool, asset: AssetRef): void {
  assert.ok(pool.base === asset || pool.quote === asset);
  assert.equal(chainOf(pool.base), chainOf(asset));
  assert.equal(chainOf(pool.quote), chainOf(asset));
  assert.ok((pool.liquidityUsdMicros ?? 0n) >= 0n);
  assert.ok((pool.volume24hUsdMicros ?? 0n) >= 0n);
  assert.ok((pool.priceUsd?.numerator ?? 0n) >= 0n);
  assert.ok((pool.priceUsd?.denominator ?? 1n) > 0n);
}

const poolChecks = (harness: MarketDataSourceHarness): readonly ContractCheck[] => [
  {
    name: "reads a known token's pools, deepest first, under an id of its own",
    run: async () => {
      const { source, known } = harness.create();
      const pools = await source.pools(known, live());
      assert.ok(pools.ok);
      assert.ok(pools.value.length > 0);
      for (const pool of pools.value) {
        assertPoolOf(pool, known);
      }
      const depths = pools.value.map((pool) => pool.liquidityUsdMicros ?? 0n);
      assert.deepEqual(depths, depths.toSorted(deeperFirst));
      assert.match(source.id, /^[a-z][a-z0-9-]{0,31}$/);
    },
  },
  {
    name: "reads no pools of a token it knows nothing of, on a chain it serves",
    run: async () => {
      const { source, unknown } = harness.create();
      assert.deepEqual(await source.pools(unknown, live()), { ok: true, value: [] });
    },
  },
  {
    name: "answers not_covered for a chain it does not serve",
    run: async () => {
      const { source, uncovered } = harness.create();
      const expected = { ok: false, error: "not_covered" };
      assert.deepEqual(await source.pools(uncovered, live()), expected);
      assert.deepEqual(await source.trending(chainOf(uncovered), live()), expected);
    },
  },
];

const trendingChecks = (harness: MarketDataSourceHarness): readonly ContractCheck[] => [
  {
    name: "reads the trending tokens of a chain it serves, each on that chain, each once",
    run: async () => {
      const { source, known } = harness.create();
      const trending = await source.trending(chainOf(known), live());
      assert.ok(trending.ok);
      const assets = trending.value.map((token) => token.asset);
      assert.equal(new Set(assets).size, assets.length);
      for (const token of trending.value) {
        assert.equal(chainOf(token.asset), chainOf(known));
        if (token.pool !== undefined) {
          assertPoolOf(token.pool, token.asset);
        }
      }
    },
  },
  {
    name: "rejects with a binference error when its service is down",
    run: async () => {
      const { down, known } = harness.create();
      await assert.rejects(down.pools(known, live()), BinferenceError);
      await assert.rejects(down.trending(chainOf(known), live()), BinferenceError);
    },
  },
  {
    name: "rejects with the signal's reason once the signal aborts",
    run: async () => {
      const { source, known } = harness.create();
      const controller = new AbortController();
      const reason = new Error("stopped");
      controller.abort(reason);
      await assert.rejects(source.pools(known, { signal: controller.signal }), reason);
      await assert.rejects(source.trending(chainOf(known), { signal: controller.signal }), reason);
    },
  },
];

/** The contract every `MarketDataSource` adapter passes. */
export function marketDataSourceContract(
  harness: MarketDataSourceHarness,
): readonly ContractCheck[] {
  return [...poolChecks(harness), ...trendingChecks(harness)];
}
