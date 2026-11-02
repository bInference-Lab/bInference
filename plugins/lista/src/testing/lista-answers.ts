import { decodeCall } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  type Hex,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
} from "viem";
import {
  allowanceKey,
  coinFor,
  isReleased,
  type ListaModel,
  type ModelLog,
  mintedFor,
  reverted,
  snapshot,
} from "./lista-model.js";

/** Where the model's contracts sit. */
export interface ModelAddresses {
  readonly manager: Address;
  readonly token: Address;
  readonly stakeHub: Address;
  readonly multicall: Address;
}

// The stake manager's and StakeHub's functions as `ListaStakeManager.sol` and `StakeHub.sol`
// declare them, written apart from the plugin's own encoders.
const managerAbi = parseAbi([
  "function paused() view returns (bool)",
  "function minBnb() view returns (uint256)",
  "function synFee() view returns (uint256)",
  "function getTotalPooledBnb() view returns (uint256)",
  "struct WithdrawalRequest { uint256 uuid; uint256 amountInSnBnb; uint256 startTime; }",
  "function getUserWithdrawalRequests(address _address) view returns (WithdrawalRequest[])",
  "function getUserRequestStatus(address _user, uint256 _idx) view returns (bool _isClaimable, uint256 _amount)",
  "function deposit() payable",
  "function requestWithdraw(uint256 _amountInSlisBnb)",
  "function claimWithdrawByUUID(uint256 _uuid)",
]);
const hubAbi = parseAbi(["function unbondPeriod() view returns (uint256)"]);
const headAbi = parseAbi([
  "function getBlockNumber() view returns (uint256)",
  "function getCurrentBlockTimestamp() view returns (uint256)",
]);
const eventsAbi = parseAbi([
  "event Deposit(address _src, uint256 _amount)",
  "event RequestWithdraw(address indexed _account, uint256 _amountInSlisBnb)",
  "event ClaimWithdrawal(address indexed _account, uint256 _idx, uint256 _amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

const uintViewsAbi = parseAbi([
  "function minBnb() view returns (uint256)",
  "function synFee() view returns (uint256)",
  "function getTotalPooledBnb() view returns (uint256)",
]);

// The stake manager's views of one number, and `paused`.
function plainView(model: ListaModel, data: Hex): Hex | undefined {
  const paused = decodeCall(managerAbi, data);
  if (paused.ok && paused.value.functionName === "paused") {
    return encodeFunctionResult({ abi: managerAbi, functionName: "paused", result: model.paused });
  }
  const call = decodeCall(uintViewsAbi, data);
  if (!call.ok) {
    return undefined;
  }
  const { functionName } = call.value;
  const numbers = { minBnb: model.minBnb, synFee: model.synFee, getTotalPooledBnb: model.pooled };
  return encodeFunctionResult({ abi: uintViewsAbi, functionName, result: numbers[functionName] });
}

// A wallet's withdrawal requests, or the status of one of them by its index in the list.
function walletView(model: ListaModel, data: Hex): Hex | undefined {
  const call = decodeCall(managerAbi, data);
  if (!call.ok) {
    return undefined;
  }
  const { value } = call;
  if (value.functionName === "getUserWithdrawalRequests") {
    const list = model.requests.get(getAddress(value.args[0])) ?? [];
    const result = list.map(({ uuid, units, startTime }) => ({
      uuid,
      amountInSnBnb: units,
      startTime,
    }));
    return encodeFunctionResult({ abi: managerAbi, functionName: value.functionName, result });
  }
  if (value.functionName !== "getUserRequestStatus") {
    return undefined;
  }
  const listed = model.requests.get(getAddress(value.args[0]))?.[Number(value.args[1])];
  const result =
    listed === undefined ? undefined : ([isReleased(model, listed), listed.coin] as const);
  return result === undefined
    ? undefined
    : encodeFunctionResult({ abi: managerAbi, functionName: value.functionName, result });
}

function managerView(model: ListaModel, data: Hex): Hex | undefined {
  return plainView(model, data) ?? walletView(model, data);
}

function tokenView(model: ListaModel, data: Hex): Hex | undefined {
  const call = decodeFunctionData({ abi: erc20Abi, data });
  if (call.functionName === "totalSupply") {
    return encodeFunctionResult({
      abi: erc20Abi,
      functionName: "totalSupply",
      result: model.supply,
    });
  }
  if (call.functionName === "balanceOf") {
    const result = model.balances.get(getAddress(call.args[0])) ?? 0n;
    return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result });
  }
  return undefined;
}

function headView(model: ListaModel, data: Hex): Hex {
  const { functionName } = decodeFunctionData({ abi: headAbi, data });
  const result = functionName === "getBlockNumber" ? model.block : model.time;
  return encodeFunctionResult({ abi: headAbi, functionName, result });
}

/** The model's answer to a view call, or `undefined` for a revert. */
export function answerView(
  model: ListaModel,
  at: ModelAddresses,
  call: { readonly to: Address; readonly data: Hex },
): Hex | undefined {
  const to = getAddress(call.to);
  try {
    if (to === at.multicall) {
      return headView(model, call.data);
    }
    if (to === at.stakeHub) {
      decodeFunctionData({ abi: hubAbi, data: call.data });
      const result = model.unbondPeriod;
      return encodeFunctionResult({ abi: hubAbi, functionName: "unbondPeriod", result });
    }
    if (to === at.token) {
      return tokenView(model, call.data);
    }
    return to === at.manager ? managerView(model, call.data) : undefined;
  } catch {
    return undefined;
  }
}

function logOf(address: Address, event: Parameters<typeof encodeEventTopics>[0], data: Hex) {
  const topics = encodeEventTopics(event).filter((topic): topic is Hex => topic !== null);
  return { address, topics, data };
}

const uints = (...values: bigint[]): Hex =>
  encodeAbiParameters(parseAbiParameters(values.map(() => "uint256").join(",")), values);

/** A transaction the model runs: from, to, its coin and its calldata. */
export interface ModelTx {
  readonly from: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
}

/** What a transaction did: the model after it, and the logs it wrote. */
export interface ModelRun {
  readonly model: ListaModel;
  readonly logs: readonly ModelLog[];
}

function transferLog(at: ModelAddresses, moved: { from: Address; to: Address; value: bigint }) {
  const args = { from: moved.from, to: moved.to };
  return logOf(at.token, { abi: eventsAbi, eventName: "Transfer", args }, uints(moved.value));
}

function deposit(model: ListaModel, at: ModelAddresses, tx: ModelTx): ModelRun {
  const minted = mintedFor(model, tx.value);
  if (tx.value === 0n || minted === 0n) {
    throw reverted("InvalidAmount");
  }
  model.balances.set(tx.from, (model.balances.get(tx.from) ?? 0n) + minted);
  const data = encodeAbiParameters(parseAbiParameters("address, uint256"), [tx.from, tx.value]);
  const logs = [
    logOf(at.manager, { abi: eventsAbi, eventName: "Deposit" }, data),
    transferLog(at, { from: zeroAddress, to: tx.from, value: minted }),
  ];
  const changed = { ...model, supply: model.supply + minted, pooled: model.pooled + tx.value };
  return { model: changed, logs };
}

function requestWithdraw(model: ListaModel, at: ModelAddresses, tx: ModelTx & { units: bigint }) {
  const { from, units } = tx;
  const allowance = model.allowances.get(allowanceKey(from, at.manager)) ?? 0n;
  const balance = model.balances.get(from) ?? 0n;
  const coin = coinFor(model, units);
  if (units === 0n || coin < model.minBnb || allowance < units || balance < units) {
    throw reverted("requestWithdraw failed");
  }
  model.allowances.set(allowanceKey(from, at.manager), allowance - units);
  model.balances.set(from, balance - units);
  const listed = model.requests.get(from) ?? [];
  const made = { uuid: model.nextUuid, units, coin, startTime: model.time };
  model.requests.set(from, [...listed, made]);
  const args = { _account: from };
  const event = { abi: eventsAbi, eventName: "RequestWithdraw", args } as const;
  const logs = [
    transferLog(at, { from, to: at.manager, value: units }),
    logOf(at.manager, event, uints(units)),
  ];
  return { model: { ...model, nextUuid: model.nextUuid + 1n }, logs };
}

function claimWithdraw(model: ListaModel, at: ModelAddresses, tx: ModelTx & { uuid: bigint }) {
  const listed = model.requests.get(tx.from) ?? [];
  const index = listed.findIndex((item) => item.uuid === tx.uuid);
  const taken = listed[index];
  if (taken === undefined || !isReleased(model, taken)) {
    throw reverted("UnclaimableRequest");
  }
  // The stake manager moves its last request into the claimed one's place.
  const last = listed.at(-1);
  const kept = listed
    .slice(0, -1)
    .map((item, place) => (place === index && last !== undefined ? last : item));
  model.requests.set(tx.from, kept);
  const args = { _account: tx.from };
  const event = { abi: eventsAbi, eventName: "ClaimWithdrawal", args } as const;
  const logs = [logOf(at.manager, event, uints(BigInt(index), taken.coin))];
  const changed = {
    ...model,
    pooled: model.pooled - taken.coin,
    supply: model.supply - taken.units,
  };
  return { model: changed, logs };
}

function approve(model: ListaModel, at: ModelAddresses, tx: ModelTx): ModelRun {
  const call = decodeFunctionData({ abi: erc20Abi, data: tx.data });
  if (call.functionName !== "approve") {
    throw reverted("only approve runs on slisBNB");
  }
  const [spender, value] = call.args;
  model.allowances.set(allowanceKey(tx.from, spender), value);
  const args = { owner: tx.from, spender };
  const logs = [logOf(at.token, { abi: eventsAbi, eventName: "Approval", args }, uints(value))];
  return { model, logs };
}

/**
 * Runs a transaction on a copy of the model, as the chain would, and answers the model after it
 * with the logs it wrote; a failure throws and changes nothing.
 */
export function runCall(model: ListaModel, at: ModelAddresses, tx: ModelTx): ModelRun {
  const next = snapshot(model);
  if (getAddress(tx.to) === at.token) {
    return approve(next, at, tx);
  }
  if (getAddress(tx.to) !== at.manager || next.paused) {
    throw reverted("Pausable: paused, or no such contract");
  }
  const call = decodeFunctionData({ abi: managerAbi, data: tx.data });
  if (call.functionName === "deposit") {
    return deposit(next, at, tx);
  }
  if (tx.value !== 0n) {
    throw reverted("not payable");
  }
  if (call.functionName === "requestWithdraw") {
    return requestWithdraw(next, at, { ...tx, units: call.args[0] });
  }
  if (call.functionName === "claimWithdrawByUUID") {
    return claimWithdraw(next, at, { ...tx, uuid: call.args[0] });
  }
  throw reverted("no such user move");
}
