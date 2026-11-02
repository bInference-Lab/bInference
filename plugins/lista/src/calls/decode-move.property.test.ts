import {
  accountRefSchema,
  assetRefSchema,
  bpsSchema,
  type StakePlan,
  type TxDraft,
} from "@binference/plugin-sdk";
import { decodeCall, decodeEvmDraft, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import * as fc from "fast-check";
import {
  concatHex,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  parseAbi,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { listaChain, slisBnbAddress, stakeManagerAddress } from "../testing/lista-world.js";
import { buildMove } from "./build-move.js";
import { decodeMove } from "./decode-move.js";

const manager = { chain: listaChain, address: stakeManagerAddress };
const pool = accountRefSchema.parse(`eip155:56:${stakeManagerAddress}`);
const coin = assetRefSchema.parse("eip155:56/slip44:714");
const receipt = assetRefSchema.parse(`eip155:56/erc20:${slisBnbAddress}`);
const address = fc
  .uint8Array({ minLength: 20, maxLength: 20 })
  .map((bytes) => getAddress(toHex(bytes)));
const accountOf = (target: string) => accountRefSchema.parse(`eip155:56:${target}`);
const units = fc.bigInt({ min: 1n, max: 2n ** 128n });

// The stake manager's functions as its verified source declares them, the three it builds and the
// siblings that name another account, take an index or skip the queue.
const managerAbi = parseAbi([
  "function deposit() payable",
  "function requestWithdraw(uint256 _amountInSlisBnb)",
  "function claimWithdrawByUUID(uint256 _uuid)",
  "function claimWithdraw(uint256 _idx)",
  "function claimWithdrawFor(address _user, uint256 _idx)",
  "function instantWithdraw(uint256 _amountInSlisBnb)",
]);

function planOf(wallet: string, action: StakePlan["action"], amount: bigint): StakePlan {
  const base = {
    wallet: accountRefSchema.parse(`eip155:56:${wallet}`),
    validator: pool,
    validatorName: "Lista",
    commissionBps: bpsSchema.parse(1_500),
    jailed: false,
    paper: false,
    unbondingSeconds: 604_800,
    plannedAtMs: 1_000,
  };
  const zero = { asset: coin, base: 0n };
  if (action === "stake") {
    const value = { asset: coin, base: amount };
    return { ...base, action, value, moved: value, shares: { asset: receipt, base: amount } };
  }
  if (action === "unstake") {
    const shares = { asset: receipt, base: amount };
    return { ...base, action, value: zero, moved: zero, shares, readyAtMs: 2_000 };
  }
  return { ...base, action, value: zero, moved: zero, parts: [amount.toString()] };
}

// What a build's calls name: each sender, the account its staking call credits, and the token and
// spender of each approval before it.
function namedBy(drafts: readonly TxDraft[]) {
  const move = drafts.at(-1);
  const decoded = move === undefined ? undefined : decodeMove(move, manager);
  const approvals = drafts.slice(0, -1).map((draft) => {
    const read = decodeEvmDraft(draft);
    const call = read.ok ? decodeCall(erc20Abi, read.value.data) : undefined;
    const isApproval = call?.ok === true && call.value.functionName === "approve";
    return read.ok && isApproval
      ? { token: read.value.to, spender: call.value.args[0] }
      : undefined;
  });
  return {
    senders: [...new Set(drafts.map((draft) => draft.from))],
    credits: decoded?.ok === true ? decoded.value.credits : undefined,
    approvals,
  };
}

// The approvals each move builds: an unstake's of slisBNB to the stake manager, none else.
const approvalsOf = {
  stake: [],
  unstake: [{ token: slisBnbAddress, spender: stakeManagerAddress }],
  claim: [],
} as const;

describe("every Lista call credits only the wallet that signs it", () => {
  it("builds each move from the plan's wallet, its staking call crediting that wallet and its approval naming only the stake manager", () => {
    fc.assert(
      fc.property(
        address,
        fc.constantFrom("stake", "unstake", "claim"),
        units,
        (wallet, action, amount) => {
          const plan = planOf(wallet, action, amount);
          const named = namedBy(buildMove(plan, manager));
          const approvals = approvalsOf[action];
          expect(named).toStrictEqual({ senders: [plan.wallet], credits: plan.wallet, approvals });
        },
      ),
    );
  });

  it("decodes no sibling, no call to another contract and no padded call, whoever it names", () => {
    fc.assert(
      fc.property(address, address, units, (wallet, other, amount) => {
        const from = accountRefSchema.parse(`eip155:56:${wallet}`);
        const draft = (data: Hex, value: bigint, target = stakeManagerAddress) =>
          encodeEvmDraft({ from, to: accountOf(target), value, data });
        const encode = encodeFunctionData;
        const drafts = [
          draft(encode({ abi: managerAbi, functionName: "claimWithdraw", args: [amount] }), 0n),
          draft(
            encode({ abi: managerAbi, functionName: "claimWithdrawFor", args: [other, amount] }),
            0n,
          ),
          draft(encode({ abi: managerAbi, functionName: "instantWithdraw", args: [amount] }), 0n),
          draft(encode({ abi: managerAbi, functionName: "deposit" }), amount, other),
          draft(
            encode({ abi: managerAbi, functionName: "requestWithdraw", args: [amount] }),
            amount,
          ),
          draft(
            encode({ abi: managerAbi, functionName: "claimWithdrawByUUID", args: [amount] }),
            0n,
            other,
          ),
          draft(
            concatHex([
              encode({ abi: managerAbi, functionName: "claimWithdrawByUUID", args: [amount] }),
              "0x01",
            ]),
            0n,
          ),
        ];
        expect(drafts.map((item) => decodeMove(item, manager))).toStrictEqual(
          drafts.map(() => ({ ok: false, error: "unknown_call" })),
        );
      }),
    );
  });
});
