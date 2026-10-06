import assert from "node:assert/strict";
import type { AssetRef, ChainRef } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { BlockReading, PriceReading } from "../market/market-reading.js";
import type { MarketData } from "../ports.js";
import { assertRefusesAborted } from "./store-fixtures.js";

/** Market data under test, what it can watch, and how a new block or price comes to pass. */
export interface MarketDataSubject {
  readonly market: MarketData;
  readonly chain: ChainRef;
  readonly asset: AssetRef;
  readonly otherAsset: AssetRef;
  /** Makes a new block appear on its chain. */
  publishBlock(reading: BlockReading): void;
  /** Makes an asset's price change to the reading's. */
  publishPrice(reading: PriceReading): void;
}

/** Makes a fresh {@link MarketDataSubject} for each check. */
export interface MarketDataHarness {
  create(): MarketDataSubject;
}

const price = (asset: AssetRef, numerator: bigint): PriceReading => ({
  asset,
  price: { numerator, denominator: 10n ** 12n },
  atMs: 1_800_000_000_000,
});

async function nextOf<Reading>(stream: AsyncIterator<Reading>): Promise<Reading> {
  const result = await stream.next();
  assert.ok(result.done !== true);
  return result.value;
}

// Runs a check with a signal that aborts once it ends, so no stream outlives its check.
async function watching(run: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  try {
    await run(controller.signal);
  } finally {
    controller.abort();
  }
}

const priceChecks = (harness: MarketDataHarness): readonly ContractCheck[] => [
  {
    name: "yields each new price of the asset it watches, in order, and no other asset's",
    run: async () =>
      watching(async (signal) => {
        const subject = harness.create();
        const stream = subject.market.prices(subject.asset, { signal })[Symbol.asyncIterator]();
        subject.publishPrice(price(subject.otherAsset, 7n));
        subject.publishPrice(price(subject.asset, 600n));
        subject.publishPrice(price(subject.asset, 610n));
        assert.deepEqual(await nextOf(stream), price(subject.asset, 600n));
        assert.deepEqual(await nextOf(stream), price(subject.asset, 610n));
      }),
  },
  {
    name: "yields nothing read before the stream started, and each reading to every watcher",
    run: async () =>
      watching(async (signal) => {
        const subject = harness.create();
        subject.publishPrice(price(subject.asset, 590n));
        const first = subject.market.prices(subject.asset, { signal })[Symbol.asyncIterator]();
        const second = subject.market.prices(subject.asset, { signal })[Symbol.asyncIterator]();
        subject.publishPrice(price(subject.asset, 600n));
        assert.deepEqual(await nextOf(first), price(subject.asset, 600n));
        assert.deepEqual(await nextOf(second), price(subject.asset, 600n));
      }),
  },
];

const blockChecks = (harness: MarketDataHarness): readonly ContractCheck[] => [
  {
    name: "yields each new block of the chain it watches, in order, once it arrives",
    run: async () =>
      watching(async (signal) => {
        const subject = harness.create();
        const stream = subject.market.blocks(subject.chain, { signal })[Symbol.asyncIterator]();
        const waiting = nextOf(stream);
        subject.publishBlock({ chain: subject.chain, number: 41n, atMs: 1 });
        subject.publishBlock({ chain: subject.chain, number: 42n, atMs: 2 });
        assert.equal((await waiting).number, 41n);
        assert.equal((await nextOf(stream)).number, 42n);
      }),
  },
  {
    name: "stops a stream with the signal's reason once the signal aborts",
    run: async () => {
      const subject = harness.create();
      const controller = new AbortController();
      const reason = new Error("stopped");
      const stream = subject.market.blocks(subject.chain, { signal: controller.signal });
      const waiting = stream[Symbol.asyncIterator]().next();
      controller.abort(reason);
      await assert.rejects(waiting, reason);
      await assertRefusesAborted(async (options) =>
        subject.market.prices(subject.asset, options)[Symbol.asyncIterator]().next(),
      );
    },
  },
];

/** The contract every `MarketData` adapter passes. */
export function marketDataContract(harness: MarketDataHarness): readonly ContractCheck[] {
  return [...priceChecks(harness), ...blockChecks(harness)];
}
