import {
  accountRefSchema,
  bpsSchema,
  assetRefSchema,
  chainRefSchema,
  type StakePlan,
  type TxDraft,
} from "@binference/plugin-sdk";
import { encodeEvmDraft } from "@binference/plugin-sdk/evm";
import * as fc from "fast-check";
import { type Address, encodeFunctionData, getAddress, type Hex, parseAbi, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { stakeHubAddress } from "../testing/stake-hub-world.js";
import { buildStake } from "./build-stake.js";
import { decodeStake } from "./decode-stake.js";

const chain = chainRefSchema.parse("eip155:56");
const coin = assetRefSchema.parse("eip155:56/slip44:714");
const hub = { chain, address: stakeHubAddress };

// Every user function of StakeHub that moves or names funds, written apart from the venue.
const hubAbi = parseAbi([
  "function delegate(address operatorAddress, bool delegateVotePower) payable",
  "function undelegate(address operatorAddress, uint256 shares)",
  "function claim(address operatorAddress, uint256 requestNumber)",
  "function redelegate(address srcValidator, address dstValidator, uint256 shares, bool delegateVotePower)",
  "function claimBatch(address[] operatorAddresses, uint256[] requestNumbers)",
  "function syncGovToken(address[] operatorAddresses, address account)",
]);

const address = fc
  .uint8Array({ minLength: 20, maxLength: 20 })
  .map((bytes): Address => getAddress(toHex(bytes)));
const units = fc.bigInt({ min: 0n, max: 2n ** 256n - 1n });
const account = (item: Address) => accountRefSchema.parse(`${chain}:${item}`);

// Any call of those functions, with any arguments: the venue's three among StakeHub's siblings.
const anyCall = fc.oneof(
  fc
    .tuple(address, fc.boolean())
    .map(([who, votes]) =>
      encodeFunctionData({ abi: hubAbi, functionName: "delegate", args: [who, votes] }),
    ),
  fc
    .tuple(address, units)
    .map(([who, count]) =>
      encodeFunctionData({ abi: hubAbi, functionName: "undelegate", args: [who, count] }),
    ),
  fc
    .tuple(address, units)
    .map(([who, count]) =>
      encodeFunctionData({ abi: hubAbi, functionName: "claim", args: [who, count] }),
    ),
  fc.tuple(address, address, units).map(([from, to, count]) =>
    encodeFunctionData({
      abi: hubAbi,
      functionName: "redelegate",
      args: [from, to, count, false],
    }),
  ),
  fc
    .tuple(address, units)
    .map(([who, count]) =>
      encodeFunctionData({ abi: hubAbi, functionName: "claimBatch", args: [[who], [count]] }),
    ),
  fc
    .tuple(address, address)
    .map(([who, other]) =>
      encodeFunctionData({ abi: hubAbi, functionName: "syncGovToken", args: [[who], other] }),
    ),
);

// A draft from the wallet to StakeHub or to any other contract, with any coin, sometimes with
// bytes past the call.
const anyDraft = fc
  .record({
    wallet: address,
    to: fc.oneof(fc.constant(stakeHubAddress), address),
    value: fc.oneof(fc.constant(0n), units),
    data: anyCall,
    tail: fc.oneof(fc.constant(""), fc.constant("00")),
  })
  .map(({ wallet, to, value, data, tail }) => ({
    wallet,
    to,
    value,
    data,
    draft: encodeEvmDraft({
      from: account(wallet),
      to: account(to),
      value,
      data: `${data}${tail}` as Hex,
    }),
  }));

// The functions StakeHub runs for the caller alone: no input but the validator names an account,
// so whatever they move is the sender's. A `delegate` that hands over votes is not among them.
function creditsOnlyTheSender(data: Hex): boolean {
  const own = [
    encodeFunctionData({ abi: hubAbi, functionName: "delegate", args: [stakeHubAddress, false] }),
    encodeFunctionData({ abi: hubAbi, functionName: "undelegate", args: [stakeHubAddress, 0n] }),
    encodeFunctionData({ abi: hubAbi, functionName: "claim", args: [stakeHubAddress, 0n] }),
  ].map((call) => call.slice(0, 10));
  const isNoVote = !data.startsWith(own[0] ?? "") || data.endsWith("0".repeat(64));
  return own.includes(data.slice(0, 10)) && isNoVote;
}

interface PlanSample {
  readonly wallet: Address;
  readonly validator: Address;
  readonly action: StakePlan["action"];
  readonly amount: bigint;
  readonly parts: number;
}

function planOf(sample: PlanSample): StakePlan {
  const { wallet, validator, action, amount, parts } = sample;
  const base = {
    action,
    wallet: account(wallet),
    validator: account(validator),
    validatorName: "Validator",
    commissionBps: bpsSchema.parse(700),
    jailed: false,
    paper: false,
    value: { asset: coin, base: action === "stake" ? amount : 0n },
    moved: { asset: coin, base: amount },
    unbondingSeconds: 604_800,
    plannedAtMs: 1_793_500_000_000,
  };
  if (action === "claim") {
    return { ...base, parts: Array.from({ length: parts }, (_, index) => `part-${String(index)}`) };
  }
  const receipt = assetRefSchema.parse(`${chain}/erc20:${validator}`);
  const pool = { shares: { asset: receipt, base: amount }, coin: { asset: coin, base: amount } };
  const priced = { shares: { asset: receipt, base: amount }, pool };
  return action === "unstake"
    ? { ...base, ...priced, readyAtMs: 1_794_104_800_000 }
    : { ...base, ...priced };
}

const plans = fc
  .record({
    wallet: address,
    validator: address,
    action: fc.constantFrom("stake" as const, "unstake" as const, "claim" as const),
    amount: fc.bigInt({ min: 1n, max: 2n ** 128n }),
    parts: fc.integer({ min: 1, max: 1_000 }),
  })
  .map(planOf);

// What a decoded draft says it does and whom it credits, or why it was refused.
function readOf(draft: TxDraft) {
  const read = decodeStake(draft, hub);
  if (!read.ok) {
    return read.error;
  }
  const { action, credits, validator, contract, value } = read.value;
  return { from: draft.from, action, credits, validator, contract, value };
}

// A refused draft, or one to StakeHub of a call that credits only its sender, with coin only on
// a stake, decoded as such.
function decodesOnlyOwnCalls(sample: {
  readonly wallet: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  readonly draft: TxDraft;
}): boolean {
  const read = decodeStake(sample.draft, hub);
  if (!read.ok) {
    return true;
  }
  const isOwnCall = sample.to === stakeHubAddress && creditsOnlyTheSender(sample.data);
  const isCoinRight = read.value.action === "stake" ? sample.value > 0n : sample.value === 0n;
  return isOwnCall && isCoinRight && read.value.credits === account(sample.wallet);
}

describe("every StakeHub call the venue builds or decodes credits only the wallet that signs", () => {
  it("builds every plan as one call to StakeHub from the plan's wallet, which decodes crediting it", () => {
    fc.assert(
      fc.property(plans, (plan) => {
        const drafts: readonly TxDraft[] = buildStake(plan, hub);
        expect(drafts.map(readOf)).toStrictEqual([
          {
            from: plan.wallet,
            action: plan.action,
            credits: plan.wallet,
            validator: plan.validator,
            contract: account(stakeHubAddress),
            value: plan.value.base,
          },
        ]);
      }),
    );
  });

  it("decodes no call that could credit another account, go elsewhere, hand over votes or misplace coin", () => {
    fc.assert(
      fc.property(anyDraft, (sample) => {
        expect(decodesOnlyOwnCalls(sample)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
