import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type AssetRef,
  assetRefParts,
  BinferenceError,
  type ChainRef,
  defineStaking,
  err,
  ok,
  type StakeRequest,
  type ReceiptPool,
  type StakingHolding,
  type StakingOptions,
  type StakingVenue,
  type VenueDeclaration,
} from "@binference/plugin-sdk";
import { parseEvmAddress, type RpcFailover } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { buildMove } from "./calls/build-move.js";
import { decodeMove } from "./calls/decode-move.js";
import { readLanded } from "./landed/read-landed.js";
import { listaContractsOn, stakeManagerName } from "./lista-contracts.js";
import type { ListaAt } from "./manager/manager-read.js";
import { readParts } from "./manager/read-parts.js";
import { readPool } from "./manager/read-pool.js";
import { type ListaPlanAt, planMove } from "./plan/plan-move.js";
import { coinFor, leastStake } from "./plan/pool-math.js";

/** The venue's id, which the chain registry names Lista's contracts after. */
export const listaId = "lista";

/** The name the venue's pool goes by on cards and in lists. */
const listaName = "Lista";

/** What the Lista venue reads and builds with on its chain. */
export interface ListaOptions {
  readonly chain: ChainRef;
  /** The chain's coin, which Lista stakes. */
  readonly coin: AssetRef;
  /** slisBNB, the token Lista's stake manager mints, as the chain registry lists it. */
  readonly receipt: AssetRef;
  /** The chain's RPC failover, which gives every read its timeout per endpoint. */
  readonly rpc: RpcFailover;
  /** The `lista` contracts of the chain registry on that chain, by their registry names. */
  readonly contracts: Readonly<Record<string, AccountRef>>;
  /** StakeHub, whose unbonding time Lista's queue waits at least, from the chain registry. */
  readonly stakeHub: AccountRef;
  /** Multicall3 on the chain, as the chain registry lists it. */
  readonly multicall: AccountRef;
}

function badOptions(problem: string): BinferenceError {
  return new BinferenceError({ code: "lista.bad_options", message: problem });
}

// The account's address, when it is an EVM account of the chain.
function evmAddressOf(chain: ChainRef, account: AccountRef | undefined): Address | undefined {
  const parts = account === undefined ? undefined : accountRefParts(account);
  const parsed = parts?.chain === chain ? parseEvmAddress(parts.address) : undefined;
  return parsed?.ok === true ? parsed.value : undefined;
}

function contractOn(chain: ChainRef, account: AccountRef | undefined, what: string): Address {
  const address = evmAddressOf(chain, account);
  if (address === undefined) {
    throw badOptions(`${what} is not an EVM account of the venue's chain.`);
  }
  return address;
}

function tokenOn(chain: ChainRef, asset: AssetRef): Address {
  const parts = assetRefParts(asset);
  const address = parseEvmAddress(parts.assetReference);
  if (parts.chain !== chain || parts.assetNamespace !== "erc20" || !address.ok) {
    throw badOptions("slisBNB is not an ERC-20 token of the venue's chain.");
  }
  return address.value;
}

function badRequest(): BinferenceError {
  return new BinferenceError({
    code: "lista.bad_request",
    message:
      "A Lista move names an EVM wallet of Lista's chain, coin above zero to stake and slisBNB above zero to unstake.",
  });
}

function walletAddress(chain: ChainRef, wallet: AccountRef): Address {
  const address = evmAddressOf(chain, wallet);
  if (address === undefined) {
    throw badRequest();
  }
  return address;
}

// A stake names the chain's coin, an unstake slisBNB or the whole holding, a claim nothing.
function checkAmount(request: StakeRequest, at: ListaAt): void {
  if (request.action === "claim" || request.amount === "whole") {
    return;
  }
  const asset = request.action === "stake" ? at.coin : at.receipt;
  if (request.amount.asset !== asset || request.amount.base <= 0n) {
    throw badRequest();
  }
}

/** What the venue declares on the chains given, without a chain to read. */
export function listaDeclaration(chains: readonly ChainRef[]): VenueDeclaration {
  return { id: listaId, contracts: chains.map(listaContractsOn) };
}

type PoolAt = ListaAt & { readonly pool: AccountRef };

// Lista's one pool, StakeHub's unbonding time, and the least coin a deposit mints a unit for.
async function optionsOf(at: PoolAt): Promise<StakingOptions> {
  const { state } = await readPool(at);
  const listed = { validator: at.pool, name: listaName, commissionBps: state.commissionBps };
  return {
    validators: [{ ...listed, jailed: false }],
    unbondingSeconds: state.unbondingSeconds,
    minStake: { asset: at.coin, base: leastStake(state) },
    readAtMs: state.timeMs,
  };
}

// slisBNB's pool, when it is named and Lista minted any: its supply and the coin it is worth.
async function poolsOf(at: PoolAt, receipts: readonly AssetRef[]): Promise<readonly ReceiptPool[]> {
  const { state } = await readPool(at);
  if (!receipts.includes(at.receipt) || state.supply === 0n) {
    return [];
  }
  const shares = { asset: at.receipt, base: state.supply };
  return [{ validator: at.pool, pool: { shares, coin: { asset: at.coin, base: state.pooled } } }];
}

async function holdingsOf(at: PoolAt, wallet: AccountRef): Promise<readonly StakingHolding[]> {
  const address = walletAddress(at.chain, wallet);
  const read = await readPool(at, { wallet: address });
  const { parts, isCut } = await readParts(at, { ...read, wallet: address });
  const balance = read.balance ?? 0n;
  if (balance === 0n && parts.length === 0) {
    return [];
  }
  const nowMs = read.state.timeMs;
  const ready = parts.filter((part) => part.queued !== true && part.readyAtMs <= nowMs);
  const claimable = ready.reduce((sum, part) => sum + part.amount.base, 0n);
  const holding: StakingHolding = {
    wallet,
    validator: at.pool,
    staked: { asset: at.receipt, base: balance },
    stakedValue: { asset: at.coin, base: coinFor(balance, read.state) },
    unbonding: parts,
    claimable: { asset: at.coin, base: claimable },
    ...(isCut ? { unbondingCut: true as const } : {}),
  };
  return [holding];
}

/**
 * Creates the Lista staking venue on one chain, over Lista's stake manager as its developer docs
 * and `ListaStakeManager.sol` describe it, with no SDK: every read takes one Multicall3 call at
 * the latest block, then the wallet's requests at that block. It lists Lista's one pool, reads a
 * wallet's slisBNB and withdrawal requests, plans a stake, an unstake or a claim or names the
 * stake manager's refusal, live or against a paper position, builds the move from the wallet,
 * decodes only such calls, and reads back what a landed move did (decisions 0331 and 0332).
 * Missing or foreign contracts are a fault (`lista.bad_options`).
 */
export function createListaVenue(options: ListaOptions): StakingVenue {
  const { chain, coin, receipt, rpc } = options;
  const manager = contractOn(chain, options.contracts[stakeManagerName], "Lista's stake manager");
  const pool = accountRefSchema.parse(`${chain}:${manager}`);
  const base = {
    chain,
    rpc,
    manager,
    token: tokenOn(chain, receipt),
    stakeHub: contractOn(chain, options.stakeHub, "StakeHub"),
    multicall: contractOn(chain, options.multicall, "Multicall3"),
    coin,
    receipt,
  };
  const at = (signal: AbortSignal): ListaPlanAt => ({ ...base, signal, pool, name: listaName });
  return defineStaking({
    ...listaDeclaration([chain]),
    chain,
    pool,
    options: async ({ signal }) => optionsOf(at(signal)),
    holdings: async (wallet, { signal }) => holdingsOf(at(signal), wallet),
    receipt: async (validator, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve(validator === pool ? ok(receipt) : err("validator_unknown"));
    },
    pools: async (receipts, { signal }) => poolsOf(at(signal), receipts),
    plan: async (request, { signal }) => {
      const reading = at(signal);
      checkAmount(request, reading);
      return planMove(reading, { request, wallet: walletAddress(chain, request.wallet) });
    },
    build: async (plan, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve(buildMove(plan, { chain, address: manager }));
    },
    decode: (draft) => decodeMove(draft, { chain, address: manager }),
    landed: async (move, { signal }) => {
      const wallet = walletAddress(chain, move.wallet);
      if (move.validator !== pool) {
        signal.throwIfAborted();
        return err("not_found");
      }
      return readLanded(at(signal), { move, wallet });
    },
  });
}
