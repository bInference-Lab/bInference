import type { Fork } from "@binference/chain-evm/fork";
import { type Address, encodeFunctionData, type Hex, parseAbi } from "viem";

// The views the venue reads, written apart from its own encoders.
const viewsAbi = parseAbi([
  "function getValidators(uint256 offset, uint256 limit) view returns (address[], address[], uint256)",
  "function getValidatorDescription(address operatorAddress) view returns ((string, string, string, string))",
  "function getValidatorCommission(address operatorAddress) view returns ((uint64, uint64, uint64))",
  "function getValidatorBasicInfo(address operatorAddress) view returns (uint256, bool, uint256)",
  "function getValidatorCreditContract(address operatorAddress) view returns (address)",
  "function getValidatorRewardRecord(address operatorAddress, uint256 index) view returns (uint256)",
  "function getValidatorTotalPooledBNBRecord(address operatorAddress, uint256 index) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalPooledBNB() view returns (uint256)",
  "function getPooledBNB(address account) view returns (uint256)",
  "function pendingUnbondRequest(address delegator) view returns (uint256)",
  "function unbondSequence(address delegator) view returns (uint256)",
]);

// How many reads anvil runs at once while it loads the fork's state from the public node.
const parallelReads = 24;
const daySeconds = 86_400n;

/** StakeHub's validator list on the fork, each operator with its credit contract. */
export interface ForkValidators {
  readonly operators: readonly Address[];
  readonly credits: readonly Address[];
}

async function readAll(
  fork: Fork,
  calls: readonly { readonly to: Address; readonly data: Hex }[],
): Promise<void> {
  const queue = [...calls];
  const worker = async (): Promise<void> => {
    for (let call = queue.shift(); call !== undefined; call = queue.shift()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each worker reads one call at a time
      await fork.client.call(call).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: parallelReads }, worker));
}

/**
 * Loads into the fork the state the venue's validator reads touch, many reads at once, and answers
 * the validator list. One Multicall3 batch of every validator's views makes anvil fetch each slot
 * from the public node in turn, which takes longer than the node keeps a block's state; the
 * venue's reads then find it in anvil's cache. A revert of the fork drops what it loaded since
 * the snapshot, so a test warms the fork inside its own snapshot.
 */
export async function warmValidators(fork: Fork, hub: Address): Promise<ForkValidators> {
  const [operators, credits] = await fork.client.readContract({
    address: hub,
    abi: viewsAbi,
    functionName: "getValidators",
    args: [0n, 0n],
  });
  const today = (await fork.client.getBlock()).timestamp / daySeconds;
  const days = [today, today - 1n];
  const hubCalls = operators.flatMap((operator) => [
    encodeFunctionData({
      abi: viewsAbi,
      functionName: "getValidatorDescription",
      args: [operator],
    }),
    encodeFunctionData({ abi: viewsAbi, functionName: "getValidatorCommission", args: [operator] }),
    encodeFunctionData({ abi: viewsAbi, functionName: "getValidatorBasicInfo", args: [operator] }),
    encodeFunctionData({
      abi: viewsAbi,
      functionName: "getValidatorCreditContract",
      args: [operator],
    }),
    ...days.flatMap((day) => [
      encodeFunctionData({
        abi: viewsAbi,
        functionName: "getValidatorRewardRecord",
        args: [operator, day],
      }),
      encodeFunctionData({
        abi: viewsAbi,
        functionName: "getValidatorTotalPooledBNBRecord",
        args: [operator, day],
      }),
    ]),
  ]);
  const totals = credits.flatMap((credit) =>
    (["totalSupply", "totalPooledBNB"] as const).map((functionName) => ({
      to: credit,
      data: encodeFunctionData({ abi: viewsAbi, functionName }),
    })),
  );
  await readAll(fork, [...hubCalls.map((data) => ({ to: hub, data })), ...totals]);
  return { operators, credits };
}

/** Loads into the fork what the venue reads of one wallet at every credit contract. */
export async function warmWallet(
  fork: Fork,
  validators: ForkValidators,
  wallet: Address,
): Promise<void> {
  const calls = validators.credits.flatMap((credit) =>
    (["balanceOf", "getPooledBNB", "pendingUnbondRequest", "unbondSequence"] as const).map(
      (functionName) => ({
        to: credit,
        data: encodeFunctionData({ abi: viewsAbi, functionName, args: [wallet] }),
      }),
    ),
  );
  await readAll(fork, calls);
}
