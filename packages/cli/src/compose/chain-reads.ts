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
import type { ChainsConfig, RpcConfig } from "../config/schema/chains-venues.schema.js";
import type { HealthSignal } from "./health-signals.js";

/**
 * What the self-hosted engine reads one chain through: its prices, wallet facts, simulations and
 * the executor's sends share one RPC failover, so they share its endpoints' health.
 */
export interface ChainReads {
  readonly chain: RegisteredChain;
  readonly evm: EvmChain;
  readonly rpc: RpcFailover;
  /** The chain's network fee cap, in wei per gas (decision 0102). */
  readonly networkFeeCap: bigint;
  /** Multicall3 on the chain, from the registry, which reads balances in one call. */
  readonly multicall: `0x${string}`;
}

/** What the chains' reads are built from. */
export interface ChainReadsOptions {
  readonly chains: ChainRegistry;
  readonly config: ChainsConfig;
  /** Outbound HTTP for the chains' RPCs. */
  readonly http: Http;
  readonly clock: Clock;
}

// A node gets 5 s to answer a read and rests 30 s after a failure.
const rpcTimeoutMs = 5_000;
const rpcRestMs = 30_000;
const gweiText = /^(\d+)(?:\.(\d{1,9}))?$/;
const weiPerGwei = 1_000_000_000n;

function refuse(code: `cli.${string}`, message: string, chain: ChainRef): BinferenceError {
  return new BinferenceError({ code, message, details: { chain } });
}

/** A fee cap in gwei, as config writes it, in wei: at most nine decimals. */
export function gweiToWei(text: string, chain: ChainRef): bigint {
  const [, whole, fraction = ""] = gweiText.exec(text) ?? [];
  if (whole === undefined) {
    throw refuse("cli.bad_fee_cap", `The network fee cap of ${chain} is not gwei.`, chain);
  }
  return BigInt(whole) * weiPerGwei + BigInt(fraction.padEnd(9, "0"));
}

/** The chain's RPCs: those config names first, then the chain's public ones. */
export function rpcEndpointsOf(
  definition: ChainDefinition,
  rpc: RpcConfig | undefined,
): readonly RpcEndpoint[] {
  const configured = (rpc?.urls ?? []).map((url, index): RpcEndpoint => ({
    name: `config-${String(index + 1)}`,
    url,
  }));
  return [...configured, ...definition.rpcs.map(({ name, url }) => ({ name, url }))];
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

function readsOf(chain: RegisteredChain, options: ChainReadsOptions): ChainReads {
  const { http, clock, config } = options;
  const capText = config.maxFeePerGasGwei[chain.ref];
  if (capText === undefined) {
    throw refuse("cli.no_fee_cap", `No network fee cap is set for ${chain.ref}.`, chain.ref);
  }
  const rpc = createRpcFailover({
    endpoints: rpcEndpointsOf(chain.definition, config.rpc[chain.ref]),
    http,
    clock,
    timeoutMs: rpcTimeoutMs,
    restMs: rpcRestMs,
  });
  return {
    chain,
    evm: evmChainOf(chain.definition),
    rpc,
    networkFeeCap: gweiToWei(capText, chain.ref),
    multicall: multicallOf(chain),
  };
}

/**
 * The reads of each chain config enables on the EVM family: one RPC failover over config's RPCs
 * and the chain's public ones, its network fee cap and its Multicall3. A chain with no fee cap in
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
