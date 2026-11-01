import type { NameResolver, SignRequest } from "@binference/chain";
import { createEvmTxSimulator } from "@binference/chain-evm";
import type { Fork } from "@binference/chain-evm/fork";
import { createEngine, createVenueHost, type Engine } from "@binference/engine";
import { createSourceMarketReads } from "@binference/engine/market";
import {
  createFakeCeilingEditor,
  createFakeRiskCheck,
  createFakeSimulator,
  createFakeWalletMaker,
  createMemoryPositionStore,
  type MemoryEngineStores,
} from "@binference/engine/testing";
import type { Address } from "viem";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import type { SelfHostedBridging } from "../compose/self-hosted-bridging.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { forkEngineBasics } from "./fork-engine-basics.js";
import { type RescueRigWallet, rescueRigParts } from "./rescue-rig-parts.js";

/** The rescue rig's engine on the fork, its stores, wallets and the owner's rescue address. */
export interface RescueRig {
  readonly engine: Engine;
  readonly stores: MemoryEngineStores;
  readonly wallets: readonly RescueRigWallet[];
  readonly rescue: Address;
  /** How many signatures the wallets' custody made. */
  readonly signatures: () => number;
  /** What the executor asked the wallets' custody to sign, oldest first. */
  readonly asked: readonly SignRequest[];
}

/**
 * The rescue rig on a fork: an engine and its executor on memory stores and the fork's BSC, with
 * two agents, three wallets whose keys sign here, a bridge wallet among them, and the owner's
 * rescue address in effect. Its executor checks a send again at the engine's prices, and both read
 * a send's name through `nameResolvers`, none when absent, and bridge through `bridging`'s parts.
 */
export async function rescueRigOf(
  fork: Fork,
  nameResolvers: readonly NameResolver[] = [],
  bridging?: SelfHostedBridging,
): Promise<RescueRig> {
  const clock = createSystemClock();
  const chains = selfHostedChains();
  const reach = { nameResolvers, ...(bridging === undefined ? {} : { bridging }) };
  const parts = await rescueRigParts(fork, reach);
  const { stores, custody, rescue, asked } = parts;
  const engine = createEngine({
    stores,
    positions: createMemoryPositionStore(),
    custody,
    ceilings: createFakeCeilingEditor({ clock }),
    walletMaker: createFakeWalletMaker({ clock, chain: fork.chain.ref, family: "evm" }),
    prices: parts.prices,
    wallets: parts.wallets,
    // The rig rescues on a fork; it reads no market data.
    marketReads: createSourceMarketReads({ sources: [], clock, timeoutMs: 5_000 }),
    host: createVenueHost({ venues: [], chains, clock, callTimeoutMs: 5_000 }),
    risk: createFakeRiskCheck({ chains, clock }),
    simulator: createFakeSimulator(new Map()),
    chainSimulator: createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain }),
    executor: parts.executor({ publish: () => undefined }),
    nameResolvers,
    ...bridging?.engine,
    ...forkEngineBasics(fork, 62),
  });
  const wallets = parts.rigWallets;
  return { engine, stores, wallets, rescue, signatures: custody.signatures, asked };
}
