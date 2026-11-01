import {
  type AbiParameter,
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  type Hex,
  parseAbi,
  zeroAddress,
} from "viem";
import type { HubModel, ModelValidator } from "./hub-model.js";

// The views a StakeHub model answers, written here apart from the plugin's own encoders.
const viewsAbi = parseAbi([
  "function getValidators(uint256 offset, uint256 limit) view returns (address[], address[], uint256)",
  "function getValidatorDescription(address operatorAddress) view returns ((string moniker, string identity, string website, string details))",
  "function getValidatorCommission(address operatorAddress) view returns ((uint64 rate, uint64 maxRate, uint64 maxChangeRate))",
  "function getValidatorBasicInfo(address operatorAddress) view returns (uint256, bool, uint256)",
  "function getValidatorCreditContract(address operatorAddress) view returns (address)",
  "function getValidatorRewardRecord(address operatorAddress, uint256 index) view returns (uint256)",
  "function getValidatorTotalPooledBNBRecord(address operatorAddress, uint256 index) view returns (uint256)",
  "function unbondPeriod() view returns (uint256)",
  "function minDelegationBNBChange() view returns (uint256)",
  "function BREATHE_BLOCK_INTERVAL() view returns (uint256)",
  "function isPaused() view returns (bool)",
  "function blackList(address account) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalPooledBNB() view returns (uint256)",
  "function getPooledBNB(address account) view returns (uint256)",
  "function pendingUnbondRequest(address delegator) view returns (uint256)",
  "function unbondRequest(address delegator, uint256 index) view returns ((uint256 shares, uint256 bnbAmount, uint256 unlockTime))",
  "function unbondSequence(address delegator) view returns (uint256)",
]);

/** A value an ABI encodes: a number, a flag, an address or text, a list or a struct of them. */
type AbiValue =
  | bigint
  | boolean
  | string
  | readonly AbiValue[]
  | { readonly [field: string]: AbiValue };

interface View {
  readonly name: string;
  readonly args: readonly AbiValue[];
}

type Values = readonly AbiValue[] | undefined;

const addressArg = (view: View): Address =>
  typeof view.args[0] === "string" ? getAddress(view.args[0]) : zeroAddress;
const numberArg = (view: View): bigint => (typeof view.args[1] === "bigint" ? view.args[1] : 0n);

function hubValues(model: HubModel, view: View): Values {
  const validators = [...model.validators.values()];
  const values: Readonly<Record<string, Values>> = {
    getValidators: [
      validators.map((item) => item.operator),
      validators.map((item) => item.credit),
      BigInt(validators.length),
    ],
    unbondPeriod: [model.unbondPeriod],
    minDelegationBNBChange: [model.minDelegation],
    BREATHE_BLOCK_INTERVAL: [model.dayLength],
    isPaused: [model.flags.paused],
    blackList: [model.blocked.has(addressArg(view))],
  };
  return values[view.name];
}

// What StakeHub answers for an operator it does not list: zeros, or a revert from
// `validatorExist`.
function unlistedValues(view: View): Values {
  const values: Readonly<Record<string, Values>> = {
    getValidatorBasicInfo: [0n, false, 0n],
    getValidatorCreditContract: [zeroAddress],
  };
  return values[view.name];
}

// A view of one validator; `undefined` reverts.
function listedValues(view: View, found: ModelValidator | undefined): Values {
  if (found === undefined) {
    return unlistedValues(view);
  }
  const day = found.rewards.get(numberArg(view));
  const values: Readonly<Record<string, Values>> = {
    getValidatorDescription: [{ moniker: found.moniker, identity: "", website: "", details: "" }],
    getValidatorCommission: [{ rate: found.commissionBps, maxRate: 10_000n, maxChangeRate: 100n }],
    getValidatorBasicInfo: [1n, found.jailed, found.jailUntil],
    getValidatorCreditContract: [found.credit],
    getValidatorRewardRecord: [day?.reward ?? 0n],
    getValidatorTotalPooledBNBRecord: [day?.pooled ?? 0n],
  };
  return values[view.name];
}

function creditValues(view: View, credit: ModelValidator): Values {
  const wallet = addressArg(view);
  const queue = credit.queues.get(wallet) ?? [];
  const held = credit.balances.get(wallet) ?? 0n;
  const request = queue[Number(numberArg(view))];
  const values: Readonly<Record<string, Values>> = {
    balanceOf: [held],
    totalSupply: [credit.supply],
    totalPooledBNB: [credit.pooled],
    getPooledBNB: credit.supply === 0n ? undefined : [(held * credit.pooled) / credit.supply],
    pendingUnbondRequest: [BigInt(queue.length)],
    unbondSequence: [credit.sequences.get(wallet) ?? 0n],
    unbondRequest: request === undefined ? undefined : [{ ...request }],
  };
  return values[view.name];
}

function viewOf(data: Hex): View | undefined {
  try {
    // viem leaves `args` out for a function without inputs, whatever its types say.
    const { functionName, args }: { functionName: string; args?: readonly AbiValue[] } =
      decodeFunctionData({ abi: viewsAbi, data });
    return { name: functionName, args: args ?? [] };
  } catch {
    return undefined;
  }
}

/**
 * The model's answer to one call, or `undefined` for a revert: StakeHub's views at the hub's
 * address, a credit contract's at its own; anything else reverts.
 */
export function answerCall(
  model: HubModel,
  hub: Address,
  call: { readonly to: Address; readonly data: Hex },
): Hex | undefined {
  const view = viewOf(call.data);
  const target = getAddress(call.to);
  const credit = [...model.validators.values()].find((item) => item.credit === target);
  if (
    view === undefined ||
    model.reverting.has(view.name) ||
    (target !== hub && credit === undefined)
  ) {
    return undefined;
  }
  const listed = model.validators.get(addressArg(view));
  const values =
    credit === undefined
      ? (hubValues(model, view) ?? listedValues(view, listed))
      : creditValues(view, credit);
  const outputs: readonly AbiParameter[] =
    viewsAbi.find((item) => item.name === view.name)?.outputs ?? [];
  return values === undefined ? undefined : encodeAbiParameters(outputs, values);
}
