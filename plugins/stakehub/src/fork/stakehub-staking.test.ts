import { bscToken, withFork } from "@binference/chain-evm/fork";
import type { ContractCheck, StakingVenueSubject } from "@binference/plugin-sdk/testing";
import { stakingVenueContract } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { foreignDrafts } from "../testing/foreign-drafts.js";
import {
  accountOn,
  addressOf,
  freshWallet,
  hashesOf,
  type Placed,
  placeStakeHub,
  runDrafts,
  stakeHub,
} from "./stake-hub-placement.js";

// The staking venue contract on the pinned BSC fork, every check in one fork session, each with a
// wallet of its own: a revert of the fork drops the state anvil loaded from the public node, which
// keeps a block's state for about a minute, so the session loads StakeHub's state once.
async function subjectOn(placed: Placed, label: string): Promise<StakingVenueSubject> {
  const { fork, venue, active, jailed, minStake } = placed;
  const wallet = await freshWallet(placed, label);
  return {
    venue,
    wallet,
    active,
    jailed,
    unknown: accountOn(fork, "0x000000000000000000000000000000000000dEaD"),
    stake: minStake,
    foreign: foreignDrafts({
      wallet,
      hub: stakeHub,
      validator: addressOf(active),
      otherValidator: addressOf(jailed),
      other: bscToken("WBNB"),
    }),
    run: async (drafts) => {
      const receipts = await runDrafts(fork, drafts);
      if (receipts.some((receipt) => receipt.status !== "success")) {
        throw new Error("A StakeHub call the venue built reverted on the fork.");
      }
      return hashesOf(receipts);
    },
    wait: async (seconds) => {
      await fork.call("evm_increaseTime", [seconds]);
      await fork.call("evm_mine", []);
    },
  };
}

// Runs every check in turn and answers the names of those that failed, with why.
async function failedChecks(placed: Placed): Promise<readonly string[]> {
  const holder: { subject?: StakingVenueSubject } = {};
  const checks: readonly ContractCheck[] = stakingVenueContract({
    create: async () => {
      const { subject } = holder;
      if (subject === undefined) {
        throw new Error("No subject was placed for this check.");
      }
      return await Promise.resolve(subject);
    },
  });
  const failed: string[] = [];
  for (const [index, check] of checks.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the checks share one fork session
    holder.subject = await subjectOn(placed, `contract check ${String(index)}`);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each check moves the fork's state
    await check.run().catch((error: unknown) => {
      failed.push(`${check.name}: ${String(error)}`);
    });
  }
  return failed;
}

describe("native BNB staking through StakeHub on a fork of BSC", () => {
  it("keeps every check of the staking venue contract", async ({ signal }) => {
    await withFork(signal, async (fork) => {
      const placed = await placeStakeHub(fork, signal);
      await expect(failedChecks(placed)).resolves.toStrictEqual([]);
    });
  });
});
