import { type AssetRef, BinferenceError, type ChainRef } from "@binference/plugin-sdk";
import { readAggregate, type RpcFailover } from "@binference/plugin-sdk/evm";
import { type Address, decodeFunctionResult, encodeFunctionData, type Hex, parseAbi } from "viem";

/** What every read of Lista runs on: the chain, its RPC failover and Lista's contracts there. */
export interface ListaAt {
  readonly chain: ChainRef;
  readonly rpc: RpcFailover;
  readonly multicall: Address;
  /** Lista's stake manager. */
  readonly manager: Address;
  /** slisBNB, the stake manager's receipt token. */
  readonly token: Address;
  /** StakeHub, whose unbonding time Lista's queue waits at least. */
  readonly stakeHub: Address;
  readonly coin: AssetRef;
  readonly receipt: AssetRef;
  readonly signal: AbortSignal;
}

/** A withdrawal request as the stake manager lists a wallet's. */
export interface WithdrawalRequest {
  readonly uuid: bigint;
  readonly units: bigint;
  /** Seconds since the epoch. */
  readonly startTime: bigint;
}

/** Whether a wallet's request can be claimed now, and the coin a claim of it pays. */
export interface RequestStatus {
  readonly isClaimable: boolean;
  readonly amount: bigint;
}

/** What one view answers. */
export type ViewValue = bigint | boolean | readonly WithdrawalRequest[] | RequestStatus;

/** One view call: the contract, its calldata, and how its answer reads. */
export interface ViewRead {
  readonly target: Address;
  readonly callData: Hex;
  /** Reads the answer; throws on an answer outside the function's shape. */
  readonly decode: (data: Hex) => ViewValue;
}

// The views read, from `ListaStakeManager.sol`, slisBNB's ERC-20, StakeHub's `unbondPeriod` and
// Multicall3's own reads of its block.
const plainAbi = parseAbi([
  "function paused() view returns (bool)",
  "function minBnb() view returns (uint256)",
  "function synFee() view returns (uint256)",
  "function getTotalPooledBnb() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function unbondPeriod() view returns (uint256)",
  "function getBlockNumber() view returns (uint256)",
  "function getCurrentBlockTimestamp() view returns (uint256)",
]);
const walletAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "struct WithdrawalRequest { uint256 uuid; uint256 amountInSnBnb; uint256 startTime; }",
  "function getUserWithdrawalRequests(address _address) view returns (WithdrawalRequest[])",
]);
const statusAbi = parseAbi([
  "function getUserRequestStatus(address _user, uint256 _idx) view returns (bool _isClaimable, uint256 _amount)",
]);

/** A view with no argument that a read asks. */
export type PlainName =
  | "paused"
  | "minBnb"
  | "synFee"
  | "getTotalPooledBnb"
  | "totalSupply"
  | "unbondPeriod"
  | "getBlockNumber"
  | "getCurrentBlockTimestamp";

/** A view with no argument. */
export function plainRead(target: Address, functionName: PlainName): ViewRead {
  return {
    target,
    callData: encodeFunctionData({ abi: plainAbi, functionName }),
    decode: (data) => decodeFunctionResult({ abi: plainAbi, functionName, data }),
  };
}

/** A wallet's slisBNB units. */
export function balanceRead(token: Address, wallet: Address): ViewRead {
  return {
    target: token,
    callData: encodeFunctionData({ abi: walletAbi, functionName: "balanceOf", args: [wallet] }),
    decode: (data) => decodeFunctionResult({ abi: walletAbi, functionName: "balanceOf", data }),
  };
}

/** A wallet's withdrawal requests, in the stake manager's order. */
export function requestsRead(manager: Address, wallet: Address): ViewRead {
  const functionName = "getUserWithdrawalRequests";
  return {
    target: manager,
    callData: encodeFunctionData({ abi: walletAbi, functionName, args: [wallet] }),
    decode: (data) =>
      decodeFunctionResult({ abi: walletAbi, functionName, data }).map((item) => ({
        uuid: item.uuid,
        units: item.amountInSnBnb,
        startTime: item.startTime,
      })),
  };
}

/** Whether a wallet's request at an index of its list can be claimed, and what it pays. */
export function statusRead(manager: Address, wallet: Address, index: bigint): ViewRead {
  const functionName = "getUserRequestStatus";
  return {
    target: manager,
    callData: encodeFunctionData({ abi: statusAbi, functionName, args: [wallet, index] }),
    decode: (data) => {
      const [isClaimable, amount] = decodeFunctionResult({ abi: statusAbi, functionName, data });
      return { isClaimable, amount };
    },
  };
}

/** A fault of a read: Lista answered outside its shape, or a view it always answers reverted. */
export function unreadable(problem: string): BinferenceError {
  return new BinferenceError({
    code: "lista.read_failed",
    message: `Lista could not be read: ${problem}`,
  });
}

function decodedOf(read: ViewRead, data: Hex | undefined): ViewValue | undefined {
  if (data === undefined) {
    return undefined;
  }
  try {
    return read.decode(data);
  } catch {
    throw unreadable("a view answered outside its function's shape.");
  }
}

/**
 * Asks every view at one block through Multicall3 in one call, `latest` unless a block is named,
 * and answers each in order, `undefined` for one that reverted. An answer outside its shape is
 * `lista.read_failed`; no node answering is `chain.rpc_down`. Rejects with the signal's reason
 * once it aborts.
 */
export async function readViews(
  at: ListaAt,
  reads: readonly ViewRead[],
  block?: bigint,
): Promise<readonly (ViewValue | undefined)[]> {
  at.signal.throwIfAborted();
  const answers = await readAggregate(at.rpc, {
    multicall: at.multicall,
    calls: reads.map(({ target, callData }) => ({ target, callData })),
    signal: at.signal,
    ...(block === undefined ? {} : { block, atHead: true }),
  });
  return reads.map((read, index) => decodedOf(read, answers[index]));
}

/** A number a read must give: a revert of a view Lista always answers is a fault. */
export function uintOf(value: ViewValue | undefined, what: string): bigint {
  if (typeof value !== "bigint") {
    throw unreadable(`${what} reverted or answered outside its shape.`);
  }
  return value;
}

/** A flag a read must give. */
export function flagOf(value: ViewValue | undefined, what: string): boolean {
  if (typeof value !== "boolean") {
    throw unreadable(`${what} reverted or answered outside its shape.`);
  }
  return value;
}

function isRequests(value: ViewValue): value is readonly WithdrawalRequest[] {
  return Array.isArray(value);
}

/** A wallet's requests a read must give. */
export function requestsOf(value: ViewValue | undefined): readonly WithdrawalRequest[] {
  if (value === undefined || !isRequests(value)) {
    throw unreadable("a wallet's withdrawal requests reverted.");
  }
  return value;
}

/** A request's status a read must give. */
export function statusOf(value: ViewValue | undefined): RequestStatus {
  if (value === undefined || typeof value !== "object" || isRequests(value)) {
    throw unreadable("a request's status reverted.");
  }
  return value;
}
