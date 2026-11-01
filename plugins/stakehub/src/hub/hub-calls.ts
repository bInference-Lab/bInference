import { type Address, decodeFunctionResult, encodeFunctionData, type Hex, parseAbi } from "viem";
import type { HubRead } from "./hub-read.js";

// StakeHub's views, from `bsc-genesis-contract/contracts/StakeHub.sol` and its
// `extension/Protectable.sol`, as BNB Chain's staking developer guide names them.
const hubAbi = parseAbi([
  "function getValidators(uint256 offset, uint256 limit) view returns (address[] operatorAddrs, address[] creditAddrs, uint256 totalLength)",
  "function getValidatorDescription(address operatorAddress) view returns ((string moniker, string identity, string website, string details))",
  "function getValidatorCommission(address operatorAddress) view returns ((uint64 rate, uint64 maxRate, uint64 maxChangeRate))",
  "function getValidatorBasicInfo(address operatorAddress) view returns (uint256 createdTime, bool jailed, uint256 jailUntil)",
  "function getValidatorCreditContract(address operatorAddress) view returns (address creditContract)",
  "function getValidatorRewardRecord(address operatorAddress, uint256 index) view returns (uint256)",
  "function getValidatorTotalPooledBNBRecord(address operatorAddress, uint256 index) view returns (uint256)",
  "function unbondPeriod() view returns (uint256)",
  "function minDelegationBNBChange() view returns (uint256)",
  "function BREATHE_BLOCK_INTERVAL() view returns (uint256)",
  "function isPaused() view returns (bool)",
  "function blackList(address account) view returns (bool)",
]);

// A validator's credit contract, from `bsc-genesis-contract/contracts/StakeCredit.sol`.
const creditAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalPooledBNB() view returns (uint256)",
  "function getPooledBNB(address account) view returns (uint256)",
  "function pendingUnbondRequest(address delegator) view returns (uint256)",
  "function unbondSequence(address delegator) view returns (uint256)",
  "function unbondRequest(address delegator, uint256 _index) view returns ((uint256 shares, uint256 bnbAmount, uint256 unlockTime))",
]);

/** StakeHub's whole validator list, each operator with its credit contract. */
export interface ValidatorList {
  readonly operators: readonly Address[];
  readonly credits: readonly Address[];
}

/** A validator's jail state. */
export interface JailState {
  readonly jailed: boolean;
  /** Seconds since the epoch. */
  readonly jailUntil: bigint;
}

/** One unstake waiting in a credit contract's queue. */
export interface UnbondRequest {
  readonly shares: bigint;
  readonly bnbAmount: bigint;
  /** Seconds since the epoch. */
  readonly unlockTime: bigint;
}

type HubName = "unbondPeriod" | "minDelegationBNBChange" | "BREATHE_BLOCK_INTERVAL";
type CreditTotal = "totalSupply" | "totalPooledBNB";
type CreditOfWallet = "balanceOf" | "getPooledBNB" | "pendingUnbondRequest" | "unbondSequence";

/** Every validator StakeHub lists, read in one call (`limit` 0 asks for all of them). */
export function validatorsRead(hub: Address): HubRead<ValidatorList> {
  const callData = encodeFunctionData({
    abi: hubAbi,
    functionName: "getValidators",
    args: [0n, 0n],
  });
  return {
    target: hub,
    callData,
    decode: (data: Hex) => {
      const [operators, credits] = decodeFunctionResult({
        abi: hubAbi,
        functionName: "getValidators",
        data,
      });
      return { operators, credits };
    },
  };
}

/** One of StakeHub's numbers: the unbonding time, the least stake, or a reward day's length. */
export function hubNumberRead(hub: Address, functionName: HubName): HubRead<bigint> {
  return {
    target: hub,
    callData: encodeFunctionData({ abi: hubAbi, functionName }),
    decode: (data: Hex) => decodeFunctionResult({ abi: hubAbi, functionName, data }),
  };
}

/** Whether StakeHub is paused, or refuses the account. */
export function hubFlagRead(hub: Address, account?: Address): HubRead<boolean> {
  const callData =
    account === undefined
      ? encodeFunctionData({ abi: hubAbi, functionName: "isPaused" })
      : encodeFunctionData({ abi: hubAbi, functionName: "blackList", args: [account] });
  return {
    target: hub,
    callData,
    decode: (data: Hex) =>
      account === undefined
        ? decodeFunctionResult({ abi: hubAbi, functionName: "isPaused", data })
        : decodeFunctionResult({ abi: hubAbi, functionName: "blackList", data }),
  };
}

/** A validator's moniker; it reverts for an operator StakeHub does not list. */
export function monikerRead(hub: Address, operator: Address): HubRead<string> {
  const functionName = "getValidatorDescription";
  return {
    target: hub,
    callData: encodeFunctionData({ abi: hubAbi, functionName, args: [operator] }),
    decode: (data: Hex) => decodeFunctionResult({ abi: hubAbi, functionName, data }).moniker,
  };
}

/** A validator's commission rate, in basis points. */
export function commissionRead(hub: Address, operator: Address): HubRead<bigint> {
  const functionName = "getValidatorCommission";
  return {
    target: hub,
    callData: encodeFunctionData({ abi: hubAbi, functionName, args: [operator] }),
    decode: (data: Hex) => decodeFunctionResult({ abi: hubAbi, functionName, data }).rate,
  };
}

/** A validator's jail state. */
export function jailRead(hub: Address, operator: Address): HubRead<JailState> {
  const functionName = "getValidatorBasicInfo";
  return {
    target: hub,
    callData: encodeFunctionData({ abi: hubAbi, functionName, args: [operator] }),
    decode: (data: Hex) => {
      const [, jailed, jailUntil] = decodeFunctionResult({ abi: hubAbi, functionName, data });
      return { jailed, jailUntil };
    },
  };
}

/** A validator's credit contract; the zero address for an operator StakeHub does not list. */
export function creditRead(hub: Address, operator: Address): HubRead<Address> {
  const functionName = "getValidatorCreditContract";
  return {
    target: hub,
    callData: encodeFunctionData({ abi: hubAbi, functionName, args: [operator] }),
    decode: (data: Hex) => decodeFunctionResult({ abi: hubAbi, functionName, data }),
  };
}

/** A validator's rewards, or its pool before them, on the reward day `day`. */
export function rewardDayRead(
  hub: Address,
  operator: Address,
  day: { readonly index: bigint; readonly part: "reward" | "pooled" },
): HubRead<bigint> {
  const functionName =
    day.part === "reward" ? "getValidatorRewardRecord" : "getValidatorTotalPooledBNBRecord";
  return {
    target: hub,
    callData: encodeFunctionData({ abi: hubAbi, functionName, args: [operator, day.index] }),
    decode: (data: Hex) => decodeFunctionResult({ abi: hubAbi, functionName, data }),
  };
}

/** A credit contract's total shares, or the coin its pool holds. */
export function creditTotalRead(credit: Address, functionName: CreditTotal): HubRead<bigint> {
  return {
    target: credit,
    callData: encodeFunctionData({ abi: creditAbi, functionName }),
    decode: (data: Hex) => decodeFunctionResult({ abi: creditAbi, functionName, data }),
  };
}

/**
 * A wallet's shares, their worth in coin, its count of waiting unstakes, or the sequence number its
 * next unstake takes, at a credit contract.
 */
export function creditOfWalletRead(
  credit: Address,
  functionName: CreditOfWallet,
  wallet: Address,
): HubRead<bigint> {
  return {
    target: credit,
    callData: encodeFunctionData({ abi: creditAbi, functionName, args: [wallet] }),
    decode: (data: Hex) => decodeFunctionResult({ abi: creditAbi, functionName, data }),
  };
}

/** One of a wallet's waiting unstakes at a credit contract, oldest first from index 0. */
export function unbondRequestRead(
  credit: Address,
  wallet: Address,
  index: bigint,
): HubRead<UnbondRequest> {
  const functionName = "unbondRequest";
  return {
    target: credit,
    callData: encodeFunctionData({ abi: creditAbi, functionName, args: [wallet, index] }),
    decode: (data: Hex) => decodeFunctionResult({ abi: creditAbi, functionName, data }),
  };
}
