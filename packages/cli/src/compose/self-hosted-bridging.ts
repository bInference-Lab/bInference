import { createAcrossBridge } from "@binference/across";
import { type ChainRef, chainRefSchema } from "@binference/chain";
import {
  createEvmAccountCodeReader,
  createEvmDeliveryReader,
  createEvmReceiptReader,
} from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import type { Clock, Http, Secret } from "@binference/core";
import type { EngineOptions } from "@binference/engine";
import type { ExecutorBridging } from "@binference/engine/executor";
import { createRelayBridge, relayId, relaySolver } from "@binference/relay";
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

/** What the bridges are made from. */
interface BridgingParts {
  readonly http: Http;
  readonly clock: Clock;
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  /** The owner's Relay API key; Relay runs keyless without one (decision 0322). */
  readonly relayKey?: Secret;
}

// The bridges that leave from the chains this binference reads, each on the routes the registry
// lists for it (decision 0301): Across from BNB Smart Chain, with its SpokePool on each chain it
// leaves from or delivers to (decisions 0315 and 0320), and Relay from BNB Smart Chain's bridge
// wallets, with its depository there (decisions 0303 and 0322).
function hostedBridges(parts: BridgingParts) {
  const source = chainRefSchema.parse(bsc.id);
  if (!parts.reads.has(source)) {
    return [];
  }
  const { http, clock, relayKey } = parts;
  const routes = bridgeRoutesOf("across");
  const spokePools = bridgeContractsOf("across", "spoke-pool");
  const across = createAcrossBridge({ http, chains: [source], routes, spokePools });
  const relayRoutes = bridgeRoutesOf(relayId);
  const relay = createRelayBridge({
    http,
    clock,
    ...(relayKey === undefined ? {} : { key: relayKey }),
    chains: [source],
    routes: relayRoutes,
    depositories: bridgeContractsOf(relayId, "depository"),
    solver: relaySolver,
  });
  return [
    { bridge: across, routes },
    { bridge: relay, routes: relayRoutes },
  ];
}

/**
 * The bridging parts of this binference (decisions 0297, 0315, 0318 and 0322): Across and Relay on
 * BNB Smart Chain with the registry's routes; the chains a bridge delivers to, each with its codec
 * and account reader; the account code readers and the delivery readers of the chains the wallets
 * use, over their reads, where a refund lands; and a delivery reader of each destination, over the
 * registry's keyless endpoints, where a fill lands. The engine and the executor share them.
 */
export function selfHostedBridging(parts: BridgingParts): SelfHostedBridging {
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
