import {
  type AccountRef,
  accountRefParts,
  type AssetRef,
  assetRefSchema,
  BinferenceError,
  type ChainRef,
  defineStaking,
  type StakingVenue,
  type VenueDeclaration,
} from "@binference/plugin-sdk";
import { parseEvmAddress, type RpcFailover } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { buildStake } from "./calls/build-stake.js";
import { decodeStake } from "./calls/decode-stake.js";
import { latestBlock } from "./hub/hub-read.js";
import { readHoldings } from "./hub/read-holdings.js";
import { type OptionsRead, readOptions } from "./hub/read-options.js";
import { readPools } from "./hub/read-pools.js";
import { readReceipt } from "./hub/read-receipt.js";
import { readLanded } from "./landed/read-landed.js";
import { planStakeMove } from "./plan/plan-stake.js";
import { govTokenName, stakeHubContractsOn, stakeHubName } from "./stakehub-contracts.js";

/** The venue's id, which the chain registry names StakeHub after. */
export const stakeHubId = "stakehub";

/** What the StakeHub venue reads and builds with on its chain. */
export interface StakeHubOptions {
  readonly chain: ChainRef;
  /** The chain's coin, which StakeHub stakes. */
  readonly coin: AssetRef;
  /** The chain's RPC failover, which gives every read its timeout per endpoint. */
  readonly rpc: RpcFailover;
  /** The `stakehub` contracts of the chain registry on that chain, by their registry names. */
  readonly contracts: Readonly<Record<string, AccountRef>>;
  /** Multicall3 on the chain, as the chain registry lists it. */
  readonly multicall: AccountRef;
}

function badOptions(problem: string): BinferenceError {
  return new BinferenceError({ code: "stakehub.bad_options", message: problem });
}

function addressOn(chain: ChainRef, account: AccountRef | undefined, what: string): Address {
  const parts = account === undefined ? undefined : accountRefParts(account);
  const address = parts === undefined ? undefined : parseEvmAddress(parts.address);
  if (parts?.chain !== chain || address?.ok !== true) {
    throw badOptions(`${what} is not an EVM account of the venue's chain.`);
  }
  return address.value;
}

function walletAddress(chain: ChainRef, wallet: AccountRef): Address {
  const parts = accountRefParts(wallet);
  const address = parseEvmAddress(parts.address);
  if (parts.chain !== chain || !address.ok) {
    throw new BinferenceError({
      code: "stakehub.bad_request",
      message: "A StakeHub move names an EVM wallet and validator of StakeHub's chain.",
    });
  }
  return address.value;
}

/**
 * What the venue declares on the chains given, without a chain to read: its id, StakeHub, and
 * `delegate`, `undelegate` and `claim`.
 */
export function stakeHubDeclaration(chains: readonly ChainRef[]): VenueDeclaration {
  return { id: stakeHubId, contracts: chains.map(stakeHubContractsOn) };
}

// StakeHub's voting token, when the registry names it.
function votingOf(chain: ChainRef, gov: AccountRef | undefined) {
  return gov === undefined
    ? {}
    : { votingToken: assetRefSchema.parse(`${chain}/erc20:${addressOn(chain, gov, "GovToken")}`) };
}

/**
 * Creates the StakeHub staking venue on one chain, over BNB Chain's native staking contracts as
 * its staking developer guide describes them: every read takes the latest block, then reads
 * StakeHub and the validators' credit contracts at that block through Multicall3. It lists the
 * validators with their commission, jail state and yearly rate, reads a wallet's stake and
 * unbonding coin, plans a move or names StakeHub's refusal, live or against a paper position,
 * builds the move as one call to StakeHub that credits the plan's wallet, decodes only such calls,
 * and reads back what a landed move did. Missing or foreign contracts are a fault
 * (`stakehub.bad_options`).
 */
export function createStakeHubVenue(options: StakeHubOptions): StakingVenue {
  const { chain, coin, rpc } = options;
  const hub = addressOn(chain, options.contracts[stakeHubName], "StakeHub");
  const multicall = addressOn(chain, options.multicall, "Multicall3");
  const voting = votingOf(chain, options.contracts[govTokenName]);
  const at = async (signal: AbortSignal): Promise<OptionsRead> => {
    const head = await latestBlock(rpc, { multicall, signal });
    return { rpc, multicall, hub, chain, coin, signal, ...voting, ...head };
  };
  return defineStaking({
    ...stakeHubDeclaration([chain]),
    chain,
    options: async ({ signal }) => readOptions(await at(signal)),
    holdings: async (wallet, { signal }) =>
      readHoldings(await at(signal), wallet, walletAddress(chain, wallet)),
    receipt: async (validator, { signal }) =>
      readReceipt(await at(signal), walletAddress(chain, validator)),
    pools: async (receipts, { signal }) => readPools(await at(signal), receipts),
    plan: async (request, { signal }) => {
      const wallet = walletAddress(chain, request.wallet);
      const validator = walletAddress(chain, request.validator);
      const isAmount =
        request.action === "claim" ||
        request.amount === "whole" ||
        (request.amount.asset === coin && request.amount.base > 0n);
      if (!isAmount) {
        throw new BinferenceError({
          code: "stakehub.bad_request",
          message: "A stake or an unstake names an amount of the chain's coin above zero.",
        });
      }
      return planStakeMove(await at(signal), { request, wallet, validator });
    },
    build: async (plan, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve(buildStake(plan, { chain, address: hub }));
    },
    decode: (draft) => decodeStake(draft, { chain, address: hub }),
    landed: async (move, { signal }) => {
      const wallet = walletAddress(chain, move.wallet);
      const validator = walletAddress(chain, move.validator);
      return readLanded(await at(signal), { move, wallet, validator });
    },
  });
}
