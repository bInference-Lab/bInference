import { type AccountRef, accountRefSchema } from "@binference/chain";
import { bscContract, type Fork } from "@binference/chain-evm/fork";
import type { StakingVenue } from "@binference/chain/staking";
import { BinferenceError } from "@binference/core";
import { parseAbi } from "viem";

const hub = bscContract("stakehub", "stake-hub");
const listAbi = parseAbi([
  "function getValidators(uint256 offset, uint256 limit) view returns (address[], address[], uint256)",
]);

/**
 * The first of StakeHub's first eight validators that takes a 1 BNB stake from `wallet` on the
 * fork, as `venue` plans it. StakeHub's list is read apart, since one read of every validator's
 * views takes the fork longer than its public node keeps the block's state.
 */
export async function activeValidator(
  fork: Fork,
  context: { readonly venue: StakingVenue; readonly wallet: AccountRef },
  signal: AbortSignal,
): Promise<AccountRef> {
  const [operators] = await fork.client.readContract({
    address: hub,
    abi: listAbi,
    functionName: "getValidators",
    args: [0n, 0n],
  });
  for (const operator of operators.slice(0, 8)) {
    const validator = accountRefSchema.parse(`${fork.chain.ref}:${operator}`);
    const amount = { asset: fork.chain.nativeAsset, base: 10n ** 18n };
    const ask = { action: "stake", wallet: context.wallet, validator, amount } as const;
    // oxlint-disable-next-line eslint/no-await-in-loop -- the first validator that takes it wins
    const planned = await context.venue.plan(ask, { signal });
    if (planned.ok) {
      return validator;
    }
  }
  throw new BinferenceError({ code: "fork.no_validator", message: "No validator takes a stake." });
}
