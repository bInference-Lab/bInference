import {
  accountRefParts,
  accountRefSchema,
  assetRefParts,
  BinferenceError,
  type StakePlan,
  type TxDraft,
} from "@binference/plugin-sdk";
import { encodeEvmApproval, encodeEvmDraft, parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { ManagerAt } from "./decode-move.js";
import { claimData, depositData, requestData } from "./manager-calls.js";

function refused(problem: string): BinferenceError {
  return new BinferenceError({
    code: "lista.bad_plan",
    message: `Lista cannot build this plan: ${problem}`,
  });
}

const uuidPattern = /^[1-9]\d{0,76}$/u;

// The request a claim names: its own id, or 0 for a paper claim, whose part is no request on the
// chain, so its call, never sent, names a request no one holds.
function claimedUuid(plan: StakePlan): bigint {
  const [ref, ...rest] = plan.parts ?? [];
  if (plan.paper) {
    return 0n;
  }
  if (ref === undefined || rest.length > 0 || !uuidPattern.test(ref)) {
    throw refused("a claim names one request by its id.");
  }
  return BigInt(ref);
}

// The token the plan's units are of, which an unstake approves to the stake manager.
function receiptAddress(plan: StakePlan, manager: ManagerAt): Address {
  const asset = plan.shares === undefined ? undefined : assetRefParts(plan.shares.asset);
  const address = asset === undefined ? undefined : parseEvmAddress(asset.assetReference);
  if (asset?.chain !== manager.chain || address?.ok !== true || plan.shares === undefined) {
    throw refused("an unstake names slisBNB units of the stake manager's chain.");
  }
  return address.value;
}

function checkPlan(plan: StakePlan, manager: ManagerAt): void {
  const pool = accountRefParts(plan.validator);
  const isOwn =
    pool.chain === manager.chain &&
    parseEvmAddress(pool.address).ok &&
    pool.address.toLowerCase() === manager.address.toLowerCase() &&
    accountRefParts(plan.wallet).chain === manager.chain;
  const isCoinOnlyOnStake = plan.action === "stake" ? plan.value.base > 0n : plan.value.base === 0n;
  if (!isOwn || !isCoinOnlyOnStake) {
    throw refused(
      "its pool is not the stake manager, or coin goes with another move than a stake.",
    );
  }
}

/**
 * The plan's calls to the stake manager, from the plan's wallet: `deposit` with the stake's coin;
 * an exact approval of the unstake's slisBNB units to the stake manager, which `requestWithdraw`
 * then pulls; or `claimWithdrawByUUID` of the one request the claim names. The stake manager
 * credits the caller in each, so the calls credit the plan's wallet alone. A plan of another
 * chain or pool, or one whose parts do not fit its action, is `lista.bad_plan`.
 */
export function buildMove(plan: StakePlan, manager: ManagerAt): readonly TxDraft[] {
  checkPlan(plan, manager);
  const to = accountRefSchema.parse(`${manager.chain}:${manager.address}`);
  const call = (data: `0x${string}`, value = 0n) =>
    encodeEvmDraft({ from: plan.wallet, to, value, data });
  if (plan.action === "stake") {
    return [call(depositData(), plan.value.base)];
  }
  if (plan.action === "claim") {
    return [call(claimData(claimedUuid(plan)))];
  }
  const token = receiptAddress(plan, manager);
  const units = plan.shares?.base ?? 0n;
  if (units === 0n) {
    throw refused("an unstake names no units.");
  }
  const approval = { wallet: plan.wallet, token, spender: manager.address, amountBase: units };
  return [encodeEvmApproval(approval), call(requestData(units))];
}
