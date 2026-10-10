import { type AccountRef, accountRefParts, type ChainRef } from "@binference/chain";
import { parseEvmAddress, readEvmBalances, readFees } from "@binference/chain-evm";
import { BinferenceError, type Clock, type Id } from "@binference/core";
import type { PositionStore, WalletFacts, WalletFactsSource } from "@binference/engine";
import { type InstallStore, recentOutflowsOf } from "@binference/engine/install";
import { type ChainReads, chainReadsOf } from "./chain-reads.js";

/** What the self-hosted wallet facts read: the install's wallets, the positions and the chains. */
export interface ChainWalletFactsOptions {
  readonly install: InstallStore;
  readonly positions: PositionStore;
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  readonly clock: Clock;
}

interface Call {
  readonly signal: AbortSignal;
}

async function liveWallets(options: ChainWalletFactsOptions, agent: Id<"agt">, call: Call) {
  const { wallets } = await options.install.read(call);
  return wallets.filter((wallet) => wallet.agentId === agent && wallet.archivedAtMs === undefined);
}

function holderOf(account: AccountRef) {
  const { chain, address } = accountRefParts(account);
  const holder = parseEvmAddress(address);
  if (!holder.ok) {
    throw new BinferenceError({
      code: "wallet.bad_account",
      message: "A wallet's account is no address of its chain.",
      details: { chain },
    });
  }
  return { chain, holder: holder.value };
}

// The coin a live wallet holds on its chain; a paper intent's comes from the paper portfolio.
async function coinBalance(reads: ChainReads, holder: `0x${string}`, call: Call): Promise<bigint> {
  const [held] = await readEvmBalances(reads.rpc, {
    chain: reads.evm,
    holder,
    assets: [reads.evm.nativeAsset],
    multicall: reads.multicall,
    signal: call.signal,
  });
  return held?.base ?? 0n;
}

async function factsOf(
  options: ChainWalletFactsOptions,
  query: Parameters<WalletFactsSource["facts"]>[0],
  call: Call,
): Promise<WalletFacts> {
  const owned = await liveWallets(options, query.agent, call);
  const wallet = owned.find(({ id }) => id === query.wallet);
  if (wallet === undefined) {
    throw new BinferenceError({
      code: "wallet.not_found",
      message: "The wallet is not one of the agent's.",
      details: { wallet: query.wallet },
    });
  }
  const { chain, holder } = holderOf(query.account);
  const reads = chainReadsOf(options.reads, chain);
  const outflows = { wallets: owned.map(({ id }) => id), isPaper: query.isPaper };
  const [nativeBalanceBase, fees, recentOutflows] = await Promise.all([
    query.isPaper ? Promise.resolve(0n) : coinBalance(reads, holder, call),
    readFees(reads.rpc, { maxFeePerGasCap: reads.networkFeeCap, signal: call.signal }),
    recentOutflowsOf(options.positions, { ...outflows, nowMs: options.clock.now() }, call),
  ]);
  return {
    nativeBalanceBase,
    ceilingPerTxNativeBase: wallet.ceiling.perTxNativeBase,
    feePerGasNativeBase: fees.fees.maxFeePerGas,
    networkFeeCapNativeBase: reads.networkFeeCap,
    recentOutflows,
  };
}

/**
 * The self-hosted {@link WalletFactsSource}: the agent's wallets from the install, oldest first so
 * its default leads, archived ones left out; a live wallet's coin and tokens read on its chain in
 * one Multicall3 call; the fee per gas from the chain's fee reader, which the auto test's fee cap
 * and the best quote read (decision 0107); the chain's network fee cap from config; the ceiling's
 * cap per transaction as custody last read it back; and the agent's recorded trades of the last
 * 24 hours in the intent's mode. A paper intent's coin balance is the paper portfolio's, which the
 * engine puts in its place, so it is read as 0 here. A wallet that is not the agent's is a
 * `wallet.not_found` fault. Every read runs on the caller's signal and the RPC failover's timeout.
 */
export function createChainWalletFacts(options: ChainWalletFactsOptions): WalletFactsSource {
  return {
    async wallets(agent, call) {
      call.signal.throwIfAborted();
      return (await liveWallets(options, agent, call)).map(({ id }) => id);
    },
    async facts(query, call) {
      call.signal.throwIfAborted();
      return factsOf(options, query, call);
    },
    async balances({ account, assets }, call) {
      call.signal.throwIfAborted();
      const { chain, holder } = holderOf(account);
      const reads = chainReadsOf(options.reads, chain);
      return readEvmBalances(reads.rpc, {
        chain: reads.evm,
        holder,
        assets,
        multicall: reads.multicall,
        signal: call.signal,
      });
    },
  };
}
