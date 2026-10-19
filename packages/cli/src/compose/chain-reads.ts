import type { ChainDefinition, ChainRef, ChainRegistry, RegisteredChain } from "@binference/chain";
import {
  createRpcFailover,
  type EvmChain,
  evmChainOf,
  evmFamilyId,
  parseEvmAddress,
  type RpcEndpoint,
  type RpcFailover,
} from "@binference/chain-evm";
import { BinferenceError, type Clock, type Http } from "@binference/core";
import { gweiToWei, isGweiText } from "../config/gwei-to-wei.js";
import type { ChainsConfig, RpcConfig } from "../config/schema/chains-venues.schema.js";
import { followingRpc } from "./following-rpc.js";
import type { HealthSignal } from "./health-signals.js";

/**
 * What the self-hosted engine reads one chain through: its prices, wallet facts, simulations and
 * the executor's sends share one RPC failover, so they share its endpoints' health.
 */
export interface ChainReads {
  readonly chain: RegisteredChain;
  readonly evm: EvmChain;
  readonly rpc: RpcFailover;
  /**
   * The failover that log queries go through (decision 0252): the RPCs config names, which always
   * win, else the registry's public log RPCs, else the chain's public ones.
   */
  readonly logsRpc: RpcFailover;
  /**
   * The chain's network fee cap now, in wei per gas (decision 0102): config's as reloaded while it
   * is at most the cap the engine started with, which the signer holds, else that one (decision
   * 0230).
   */
  readonly networkFeeCapWeiPerGas: () => bigint;
  /** Multicall3 on the chain, from the registry, which reads balances in one call. */
  readonly multicall: `0x${string}`;
}

/** What the chains' reads are built from. */
export interface ChainReadsOptions {
  readonly chains: ChainRegistry;
  /** The chains' config the engine started with. */
  readonly config: ChainsConfig;
  /**
   * The chains' config as reloaded, which each RPC request reads its endpoints from (decision
   * 0230); the config the engine started with when absent.
   */
  readonly current?: () => ChainsConfig;
  /** Outbound HTTP for the chains' RPCs. */
  readonly http: Http;
  readonly clock: Clock;
}

// A node gets 5 s to answer a read and rests 30 s after a failure.
const rpcTimeoutMs = 5_000;
const rpcRestMs = 30_000;

function refuse(code: `cli.${string}`, message: string, chain: ChainRef): BinferenceError {
  return new BinferenceError({ code, message, details: { chain } });
}

function configuredOf(rpc: RpcConfig | undefined): readonly RpcEndpoint[] {
  return (rpc?.urls ?? []).map((url, index) => ({ name: `config-${String(index + 1)}`, url }));
}

/** The chain's RPCs: those config names first, then the chain's public ones. */
export function rpcEndpointsOf(
  definition: ChainDefinition,
  rpc: RpcConfig | undefined,
): readonly RpcEndpoint[] {
  return [...configuredOf(rpc), ...definition.rpcs.map(({ name, url }) => ({ name, url }))];
}

/**
 * The RPCs that answer the chain's log queries (decision 0252): those config names, else the
 * registry's public log RPCs, else the chain's public RPCs.
 */
export function logEndpointsOf(
  definition: ChainDefinition,
  rpc: RpcConfig | undefined,
): readonly RpcEndpoint[] {
  const configured = configuredOf(rpc);
  const listed = definition.logRpcs ?? definition.rpcs;
  return configured.length > 0 ? configured : listed.map(({ name, url }) => ({ name, url }));
}

function multicallOf(chain: RegisteredChain): `0x${string}` {
  const listed = chain.definition.contracts.find(
    (contract) => contract.venue === "multicall3" && contract.name === "multicall3",
  );
  const address = listed === undefined ? undefined : parseEvmAddress(listed.address);
  if (address?.ok !== true) {
    throw refuse("cli.no_multicall", `The ${chain.ref} registry lists no Multicall3.`, chain.ref);
  }
  return address.value;
}

// The reloaded cap when it is no higher than the cap at start, else the cap at start: a higher cap
// waits for a restart, and one that does not read as gwei keeps the cap at start.
function feeCapNow(chain: ChainRef, startedWei: bigint, current: () => ChainsConfig): () => bigint {
  return () => {
    const text = current().maxFeePerGasGwei[chain];
    if (text === undefined || !isGweiText(text)) {
      return startedWei;
    }
    const wei = gweiToWei(text, chain);
    return wei < startedWei ? wei : startedWei;
  };
}

function readsOf(chain: RegisteredChain, options: ChainReadsOptions): ChainReads {
  const { http, clock, config } = options;
  const capText = config.maxFeePerGasGwei[chain.ref];
  if (capText === undefined) {
    throw refuse("cli.no_fee_cap", `No network fee cap is set for ${chain.ref}.`, chain.ref);
  }
  const current = options.current ?? (() => config);
  const failoverOf = (endpoints: readonly RpcEndpoint[]): RpcFailover =>
    createRpcFailover({ endpoints, http, clock, timeoutMs: rpcTimeoutMs, restMs: rpcRestMs });
  const rpc = followingRpc(
    () => rpcEndpointsOf(chain.definition, current().rpc[chain.ref]),
    failoverOf,
  );
  const logsRpc = followingRpc(
    () => logEndpointsOf(chain.definition, current().rpc[chain.ref]),
    failoverOf,
  );
  return {
    chain,
    evm: evmChainOf(chain.definition),
    rpc,
    logsRpc,
    networkFeeCapWeiPerGas: feeCapNow(chain.ref, gweiToWei(capText, chain.ref), current),
    multicall: multicallOf(chain),
  };
}

/**
 * The reads of each chain config enables on the EVM family: one RPC failover over config's RPCs
 * as they stand at each request and the chain's public ones, its network fee cap and its
 * Multicall3. A chain with no fee cap in
 * config, or whose registry lists no Multicall3, stops the start.
 */
export function composeChainReads(options: ChainReadsOptions): ReadonlyMap<ChainRef, ChainReads> {
  const enabled = options.chains
    .list()
    .filter((chain) => chain.definition.family === evmFamilyId)
    .filter((chain) => options.config.enabled.includes(chain.ref));
  return new Map(enabled.map((chain) => [chain.ref, readsOf(chain, options)]));
}

/** The reads of one chain; a chain the engine has none for is a `cli.no_chain_parts` fault. */
export function chainReadsOf(
  reads: ReadonlyMap<ChainRef, ChainReads>,
  chain: ChainRef,
): ChainReads {
  const found = reads.get(chain);
  if (found === undefined) {
    throw refuse("cli.no_chain_parts", `No chain parts are set up for ${chain}.`, chain);
  }
  return found;
}

/**
 * The `rpc` health signal: failed while every endpoint of a chain rests after a failure, a
 * warning while some do, else ok; the worst chain decides.
 */
export function rpcHealthOf(
  reads: ReadonlyMap<ChainRef, ChainReads>,
  clock: Clock,
): HealthSignal["state"] {
  const nowMs = clock.now();
  const states = new Set(
    [...reads.values()].map(({ rpc }) => {
      const health = rpc.health();
      const resting = health.filter((endpoint) => (endpoint.restingUntilMs ?? 0) > nowMs).length;
      if (resting === 0) {
        return "ok";
      }
      return resting === health.length ? "fail" : "warn";
    }),
  );
  if (states.has("fail")) {
    return "fail";
  }
  return states.has("warn") ? "warn" : "ok";
}
