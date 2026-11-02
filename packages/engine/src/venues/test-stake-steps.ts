import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
} from "@binference/chain";
import type {
  DecodedStake,
  LandedStake,
  StakePlan,
  UnbondingPart,
} from "@binference/chain/staking";
import { createFakeFamily, fakeDraft } from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import type { StakeBounds, StakeStep } from "./stake-checks.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const receipt = assetRefSchema.parse("fake:1/token:0x000000c1");

const stakeWallet: AccountRef = accountRefSchema.parse("fake:1:0x0000000c");
const stakeValidator: AccountRef = accountRefSchema.parse("fake:1:0x000000c1");
const stakeHub: AccountRef = accountRefSchema.parse("fake:1:0x000000d1");

/** An unstake of 10 receipt units, worth 12 units of the coin, planned for the wallet. */
export const testUnstakePlan: StakePlan = {
  action: "unstake",
  wallet: stakeWallet,
  validator: stakeValidator,
  validatorName: "Active",
  commissionBps: bpsSchema.parse(700),
  jailed: false,
  paper: false,
  value: { asset: coin, base: 0n },
  moved: { asset: coin, base: 12n },
  shares: { asset: receipt, base: 10n },
  pool: { shares: { asset: receipt, base: 100n }, coin: { asset: coin, base: 120n } },
  unbondingSeconds: 60,
  readyAtMs: 1_800_000_060_000,
  plannedAtMs: 1_800_000_000_000,
};

/** What the venue declares and how the wallet's family compares accounts. */
export const testStakeBounds: StakeBounds = { contracts: [stakeHub], family: createFakeFamily() };

/** The unstake's one call as the host read it, with its decoded move changed as given. */
export function testStakeStep(
  change: Partial<DecodedStake> = {},
  from: AccountRef = stakeWallet,
): StakeStep {
  const draft = fakeDraft(from, { to: "0x000000d1", value: 0n, data: "undelegate,0x000000c1,10" });
  const decoded: DecodedStake = {
    action: "unstake",
    contract: stakeHub,
    validator: stakeValidator,
    credits: stakeWallet,
    value: 0n,
    shares: 10n,
    ...change,
  };
  return { draft, decoded };
}

const { shares: _shares, pool: _pool, readyAtMs: _readyAtMs, ...unstakeBase } = testUnstakePlan;

/** A claim of the wallet's one part `r:1`, worth 12 units of the coin, planned for the wallet. */
export const testClaimPlan: StakePlan = { ...unstakeBase, action: "claim", parts: ["r:1"] };

/** The validator's receipt token, which the test unstake burns. */
export const testStakeReceipt: AssetRef = receipt;

/** The request the test unstake opened, ready as soon as its unbonding time allows. */
export const testUnstakeRequest: UnbondingPart = {
  ref: "r:1",
  amount: { asset: coin, base: 12n },
  readyAtMs: testUnstakePlan.plannedAtMs + 60_000,
};

/** What a venue reads back of the test unstake once it landed, as its plan says. */
export const testLandedUnstake: LandedStake = {
  action: "unstake",
  validator: stakeValidator,
  moved: { asset: coin, base: 12n },
  shares: { asset: receipt, base: 10n },
  request: testUnstakeRequest,
};
