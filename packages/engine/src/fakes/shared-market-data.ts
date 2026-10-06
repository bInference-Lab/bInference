import type { AssetRef } from "@binference/chain";
import { err, ok } from "@binference/core";
import type { BlockReading, PriceReading } from "../market/market-reading.js";
import type { MarketData, PriceSource } from "../ports.js";
import { createFanOut } from "./fan-out.js";

/**
 * Market data for tests, shaped like a shared market-data service: one subscription per chain or
 * asset fans out to every watcher, and a price asked for now is the asset's last reading.
 */
export interface SharedMarketData extends MarketData, PriceSource {
  /** Hands a new block to every watcher of its chain. */
  publishBlock(reading: BlockReading): void;
  /** Hands a new price to every watcher of its asset, and keeps it as the asset's price now. */
  publishPrice(reading: PriceReading): void;
  /** How many chains and assets have a watcher now: the subscriptions the service holds. */
  subscriptions(): number;
}

/** Creates a {@link SharedMarketData} with no reading yet. */
export function createSharedMarketData(): SharedMarketData {
  const blocks = createFanOut<BlockReading>();
  const prices = createFanOut<PriceReading>();
  const last = new Map<AssetRef, PriceReading>();
  return {
    blocks: (chain, options) => blocks.watch(chain, options.signal),
    prices: (asset, options) => prices.watch(asset, options.signal),
    async usdPrice(asset, options) {
      options.signal.throwIfAborted();
      const reading = last.get(asset);
      return await Promise.resolve(reading === undefined ? err("no_price") : ok(reading.price));
    },
    publishBlock: (reading) => blocks.publish(reading.chain, reading),
    publishPrice: (reading) => {
      last.set(reading.asset, reading);
      prices.publish(reading.asset, reading);
    },
    subscriptions: () => blocks.topics() + prices.topics(),
  };
}
