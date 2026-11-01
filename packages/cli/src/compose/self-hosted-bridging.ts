import { createAcrossBridge } from "@binference/across";
import { type ChainRef, chainRefSchema } from "@binference/chain";
import {
  createEvmAccountCodeReader,
  createEvmDeliveryReader,
  createEvmReceiptReader,
} from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import type { Clock, Http } from "@binference/core";
import type { EngineOptions } from "@binference/engine";
import type { ExecutorBridging } from "@binference/engine/executor";
import { bridgeContractsOf, bridgeRoutesOf } from "./bridge-routes.js";
import type { ChainReads } from "./chain-reads.js";
import { deliveryReaderOf } from "./delivery-readers.js";
import { selfHostedDestinationChains } from "./destination-chains.js";
import { selfHostedDestinations } from "./self-hosted-destinations.js";

/** What this binference bridges with: the engine's part and the executor's. */
export interface SelfHostedBridging {
  readonly engine: Required<
    Pick<EngineOptions, "bridges" | "codeReaders" | "deliveryReaders" | "destinations">
  >;
  readonly executor: ExecutorBridging;
}

// The bridges that leave from the chains this binference reads: Across from BNB Smart Chain, on the
// routes the registry lists for it (decisions 0301 and 0315), with its SpokePool on each chain it
// leaves from or delivers to (decision 0320).
function hostedBridges(parts: {
  readonly http: Http;
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
}) {
  const source = chainRefSchema.parse(bsc.id);
  if (!parts.reads.has(source)) {
    return [];
  }
  const routes = bridgeRoutesOf("across");
  const spokePools = bridgeContractsOf("across", "spoke-pool");
  const bridge = createAcrossBridge({ http: parts.http, chains: [source], routes, spokePools });
  return [{ bridge, routes }];
}

/**
 * The bridging parts of this binference (decisions 0297, 0315 and 0318): Across on BNB Smart Chain
 * with the registry's routes; the chains a bridge delivers to, each with its codec and account
 * reader; the account code readers and the delivery readers of the chains the wallets use, over
 * their reads, where a refund lands; and a delivery reader of each destination, over the
 * registry's keyless endpoints, where a fill lands. The engine and the executor share them.
 */
export function selfHostedBridging(parts: {
  readonly http: Http;
  readonly clock: Clock;
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
}): SelfHostedBridging {
  const bridges = hostedBridges(parts);
  const destinations = selfHostedDestinationChains(parts);
  const reads = [...parts.reads.values()];
  const codeReaders = reads.map(({ rpc, evm }) => createEvmAccountCodeReader({ rpc, chain: evm }));
  const sources = reads.map(({ rpc, evm, chain, multicall }) => {
    const receipts = createEvmReceiptReader({
      rpc,
      chain: evm,
      finality: chain.definition.finality,
    });
    return createEvmDeliveryReader({ rpc, chain: evm, receipts, multicall });
  });
  const arrivals = selfHostedDestinations().flatMap((definition) => {
    const reader = deliveryReaderOf(definition, parts);
    return reader === undefined ? [] : [reader];
  });
  return {
    engine: { bridges, codeReaders, deliveryReaders: [...sources, ...arrivals], destinations },
    executor: { bridges: bridges.map(({ bridge }) => bridge), destinations, codeReaders },
  };
}
