import { type AccountRef, accountRefSchema } from "@binference/chain";
import { bscContract, type Fork, withFork } from "@binference/chain-evm/fork";
import type { StakingVenue } from "@binference/chain/staking";
import { BinferenceError } from "@binference/core";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { createStakeHubVenue } from "@binference/stakehub";
import { type Address, parseAbi, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { startMining } from "./executor-rig.js";
import { rescueAgents } from "./rescue-rig-parts.js";
import { type RescueRig, rescueRigOf } from "./rescue-rig.js";
import { cardTextOf, confirmOn, endedStates, proposeOn, reachOn } from "./rig-calls.js";

// A stake, an unstake of the whole stake and a claim through the engine and its executor on a fork
// of BSC: each planned through StakeHub before its card, planned again as the queue takes it,
// signed by the wallet's key, and reconciled from what StakeHub reads back of the landed move.
const hub = bscContract("stakehub", "stake-hub");
const govToken = bscContract("stakehub", "gov-token");
const multicall = bscContract("multicall3", "multicall3");
const bnb = 10n ** 18n;
const listAbi = parseAbi([
  "function getValidators(uint256 offset, uint256 limit) view returns (address[], address[], uint256)",
]);
const [agent] = rescueAgents;

const accountOf = (fork: Fork, address: Address): AccountRef =>
  accountRefSchema.parse(`${fork.chain.ref}:${address}`);

// StakeHub on the fork as the engine runs it: each plan reads the chosen validator's yearly rate.
function stakeHubOn(fork: Fork): StakingVenue {
  return createStakeHubVenue({
    chain: fork.chain.ref,
    coin: fork.chain.nativeAsset,
    rpc: fork.rpc,
    contracts: { "stake-hub": accountOf(fork, hub), "gov-token": accountOf(fork, govToken) },
    multicall: accountOf(fork, multicall),
  });
}

// The first validator StakeHub lists that takes a stake now.
// StakeHub's list is read apart, since one read of every validator's views takes the fork longer
// than its public node keeps the block's state.
async function activeValidator(
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
    const validator = accountOf(fork, operator);
    const amount = { asset: fork.chain.nativeAsset, base: bnb };
    const ask = { action: "stake", wallet: context.wallet, validator, amount } as const;
    // oxlint-disable-next-line eslint/no-await-in-loop -- the first validator that takes it wins
    const planned = await context.venue.plan(ask, { signal });
    if (planned.ok) {
      return validator;
    }
  }
  throw new BinferenceError({ code: "fork.no_validator", message: "No validator takes a stake." });
}

function stakeOf(
  validator: AccountRef,
  action: "stake" | "unstake" | "claim",
  fork: Fork,
): IntentRequest {
  if (agent === undefined) {
    throw new BinferenceError({ code: "fork.no_agent", message: "The rig has no agent." });
  }
  const base = {
    kind: "stake",
    agent,
    reason: "Earn on idle BNB",
    action,
    venue: "stakehub",
    validator,
  } as const;
  return action === "stake"
    ? { ...base, amount: { asset: fork.chain.nativeAsset, base: bnb } }
    : base;
}

// The agent's main wallet with no code and 3 BNB.
async function fundedMain(fork: Fork, rig: RescueRig): Promise<RescueRig["wallets"][number]> {
  const [main] = rig.wallets;
  if (main === undefined) {
    throw new BinferenceError({ code: "fork.no_wallet", message: "The rig has no wallet." });
  }
  await fork.call("anvil_setCode", [main.address, "0x"]);
  await fork.call("anvil_setBalance", [main.address, toHex(3n * bnb)]);
  return main;
}

// Proposes the move, taps its card, and answers its view and its card's lines once it settled.
async function tapped(
  rig: RescueRig,
  request: IntentRequest,
  signal: AbortSignal,
): Promise<{
  readonly view: IntentView;
  readonly lines: readonly string[];
  readonly state: string;
}> {
  const view = await proposeOn(rig, request, signal);
  expect([view.state, view.outcome?.reason]).toStrictEqual(["awaiting_confirmation", undefined]);
  const lines = await cardTextOf(rig, view, signal);
  await confirmOn(rig, view, signal);
  return { view, lines, state: await reachOn(rig, view.intent, endedStates) };
}

describe("staking through the engine on the BSC fork", () => {
  it("stakes 1 BNB, unstakes the whole stake, then claims it back once it unbonded", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      const venue = stakeHubOn(fork);
      const rig = await rescueRigOf(fork, { stakingVenues: [venue] });
      const main = await fundedMain(fork, rig);
      const wallet = accountOf(fork, main.address);
      const validator = await activeValidator(fork, { venue, wallet }, signal);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      try {
        const staked = await tapped(rig, stakeOf(validator, "stake", fork), signal);
        expect(staked.lines[1]).toMatch(/^Stake 1 BNB with .+ \(0x[0-9a-fA-F]{4}/u);
        expect(staked.lines[2]).toMatch(/^Validator .+ · commission \d/u);
        expect(staked.lines[3]).toMatch(
          /^Yearly rate \d+(?:\.\d+)?%, from its last day of rewards$/u,
        );
        expect(staked.state).toBe("reconciled");
        const [held] = await venue.holdings(wallet, { signal });
        expect(held?.stakedValue.base).toBeGreaterThan(bnb - 10n);

        const unstaked = await tapped(rig, stakeOf(validator, "unstake", fork), signal);
        expect(unstaked.lines[1]).toMatch(/· ready in 7 days$/u);
        expect(unstaked.lines[3]).toMatch(/^Locked while it unbonds: you can claim it from /u);
        expect(unstaked.state).toBe("reconciled");
        const query = { walletId: main.wallet, isPaper: false, venue: "stakehub", validator };
        const [open] = await rig.stores.unbondings.listOpen(query, { signal });
        expect(open?.amount.base).toBeGreaterThan(bnb - 10n);

        const early = await proposeOn(rig, stakeOf(validator, "claim", fork), signal);
        expect([early.state, early.outcome?.reason]).toStrictEqual([
          "failed_check",
          "nothing_to_claim",
        ]);
        await fork.call("evm_increaseTime", [toHex(8 * 86_400)]);
        await fork.call("evm_mine", []);
        const before = await fork.client.getBalance({ address: main.address });
        const claimed = await tapped(rig, stakeOf(validator, "claim", fork), signal);
        expect(claimed.state).toBe("reconciled");
        const after = await fork.client.getBalance({ address: main.address });
        expect(after - before).toBeGreaterThan(bnb - 10n ** 16n);
        const taken = await rig.stores.unbondings.claimedBy(claimed.view.intent, { signal });
        expect(taken.map((row) => row.requestRef)).toStrictEqual([open?.requestRef]);
      } finally {
        miner.abort();
        await mining;
      }
    });
  });
});
