import {
  type AccountRef,
  accountRefSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { decodeEvmDraft } from "@binference/chain-evm";
import { bscContract, type Fork, withFork } from "@binference/chain-evm/fork";
import type { StakePlan, StakingVenue } from "@binference/chain/staking";
import { bsc } from "@binference/chains";
import { buildCeiling, registryCeilingChain } from "@binference/custody-privy";
import { ceilingVerdict, testCaps } from "@binference/custody-privy/testing";
import { createStakeHubVenue, stakeHubDeclaration } from "@binference/stakehub";
import { type Address, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

// A 2 BNB stake on a BSC fork under the ceiling the planner builds from the registry: StakeHub's
// `delegate` in its own rule up to 100 BNB (decision 0325), every other call at the 1 BNB cap per
// call. The fake's policy engine judges the stake's own bytes, which then land on the fork.
const hub = bscContract("stakehub", "stake-hub");
const multicall = bscContract("multicall3", "multicall3");
const bscRef: ChainRef = chainRefSchema.parse(bsc.id);
const rescue = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
const bnb = 10n ** 18n;
const listAbi = parseAbi([
  "function getValidators(uint256 offset, uint256 limit) view returns (address[], address[], uint256)",
]);

const accountOf = (fork: Fork, address: Address): AccountRef =>
  accountRefSchema.parse(`${fork.chain.ref}:${address}`);

// The ceiling request a wallet that may stake gets from the registry, its native 24-hour cap far
// above a day's stakes.
function stakingCeiling() {
  const plan = registryCeilingChain({
    definition: bsc,
    venues: [stakeHubDeclaration([bscRef])],
    perTxNativeCapBase: bnb,
  });
  if (!plan.ok) {
    throw new Error(`The registry plans no ceiling: ${plan.error}.`);
  }
  const caps = { ...testCaps, native: { ...testCaps.native, limitBase: 1_000n * bnb } };
  const saved = [{ chainId: "56", addresses: [rescue] }];
  return { chains: [{ ...plan.value, caps }], rescue, saved };
}

// A plan of a stake of the amount with the first validator StakeHub lists that takes it.
async function stakePlan(
  { fork, venue }: { readonly fork: Fork; readonly venue: StakingVenue },
  base: bigint,
  signal: AbortSignal,
) {
  const [operators] = await fork.client.readContract({
    address: hub,
    abi: listAbi,
    functionName: "getValidators",
    args: [0n, 0n],
  });
  for (const operator of operators.slice(0, 8)) {
    const amount = { asset: fork.chain.nativeAsset, base };
    const ask = {
      action: "stake",
      wallet: accountOf(fork, fork.account),
      validator: accountOf(fork, operator),
      amount,
    } as const;
    // oxlint-disable-next-line eslint/no-await-in-loop -- the first validator that takes it wins
    const planned = await venue.plan(ask, { signal });
    if (planned.ok) {
      return planned.value;
    }
  }
  throw new Error("None of StakeHub's first validators takes a stake on the fork.");
}

async function verdictOf(venue: StakingVenue, plan: StakePlan, fork: Fork) {
  const [draft] = await venue.build(plan, { signal: new AbortController().signal });
  const call = draft === undefined ? undefined : decodeEvmDraft(draft);
  if (call?.ok !== true) {
    throw new Error("The venue built no EVM call.");
  }
  const { to, value: valueWei, data } = call.value;
  const tx = { chainId: 56n, to, valueWei, data, walletAddress: fork.account };
  return { verdict: ceilingVerdict(stakingCeiling(), tx), call: call.value };
}

describe("a stake under the planned ceiling on a fork of BSC", () => {
  it("signs a 2 BNB stake under the stake's own cap and lands it, and refuses one past 100 BNB", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      const venue = createStakeHubVenue({
        chain: fork.chain.ref,
        coin: fork.chain.nativeAsset,
        rpc: fork.rpc,
        contracts: { "stake-hub": accountOf(fork, hub) },
        multicall: accountOf(fork, multicall),
      });
      const stake = await stakePlan({ fork, venue }, 2n * bnb, signal);
      const signed = await verdictOf(venue, stake, fork);
      const pastCap = { ...stake, value: { ...stake.value, base: 100n * bnb + 1n } };
      const refused = await verdictOf(venue, pastCap, fork);
      const receipt = await fork.send(signed.call);

      expect(buildCeiling(stakingCeiling()).ok).toBe(true);
      expect([signed.verdict, refused.verdict]).toStrictEqual(["ALLOW", "DENY"]);
      expect(receipt.status).toBe("success");
    });
  });
});
