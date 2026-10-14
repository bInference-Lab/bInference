import type { Hex } from "viem";
import { assemble, fail, type Item, op, p, returnWord, transferTopic } from "./crash-assembler.js";

// transfer(to, amount): moves the caller's units, logs Transfer, answers true.
const transfer: readonly Item[] = [
  { mark: "transfer" },
  p(1, 0x24n),
  op.callDataLoad,
  op.caller,
  op.sload,
  op.dup2,
  op.dup2,
  op.lt,
  { to: "fail" },
  op.jumpI,
  op.dup2,
  op.swap1,
  op.sub,
  op.caller,
  op.sstore,
  p(1, 4n),
  op.callDataLoad,
  op.dup1,
  op.sload,
  op.dup3,
  op.add,
  op.swap1,
  op.sstore,
  p(1, 0n),
  op.mstore,
  p(1, 4n),
  op.callDataLoad,
  op.caller,
  p(32, transferTopic),
  p(1, 32n),
  p(1, 0n),
  op.log3,
  p(1, 1n),
  ...returnWord,
];

// A call data word at its offset, or the caller's own address.
function word(at: number | "caller"): readonly Item[] {
  return at === "caller" ? [op.caller] : [p(1, BigInt(at)), op.callDataLoad];
}

// The storage slot of what `owner` lets `spender` move: keccak256 of both words, each from the
// call data word at its offset, or the caller's own address.
function allowanceSlot(owner: number | "caller", spender: number | "caller"): readonly Item[] {
  return [
    ...word(owner),
    p(1, 0n),
    op.mstore,
    ...word(spender),
    p(1, 32n),
    op.mstore,
    p(1, 64n),
    p(1, 0n),
    op.sha3,
  ];
}

// approve(spender, amount): sets what the caller lets the spender move, answers true.
const approve: readonly Item[] = [
  { mark: "approve" },
  p(1, 0x24n),
  op.callDataLoad,
  ...allowanceSlot("caller", 4),
  op.sstore,
  p(1, 1n),
  ...returnWord,
];

// allowance(owner, spender): what the owner lets the spender move.
const allowance: readonly Item[] = [
  { mark: "allowance" },
  ...allowanceSlot(4, 0x24),
  op.sload,
  ...returnWord,
];

// Takes `amount`, the word at 0x44, from the slot on top of the stack, or fails when it holds less.
const debit: readonly Item[] = [
  op.dup1,
  op.sload,
  p(1, 0x44n),
  op.callDataLoad,
  op.dup1,
  op.dup3,
  op.lt,
  { to: "fail" },
  op.jumpI,
  op.swap1,
  op.sub,
  op.swap1,
  op.sstore,
];

// transferFrom(from, to, amount): moves units the owner let the caller move, logs Transfer,
// answers true.
const transferFrom: readonly Item[] = [
  { mark: "transferFrom" },
  ...allowanceSlot(4, "caller"),
  ...debit,
  p(1, 4n),
  op.callDataLoad,
  ...debit,
  p(1, 0x24n),
  op.callDataLoad,
  op.dup1,
  op.sload,
  p(1, 0x44n),
  op.callDataLoad,
  op.add,
  op.swap1,
  op.sstore,
  p(1, 0x44n),
  op.callDataLoad,
  p(1, 0n),
  op.mstore,
  p(1, 0x24n),
  op.callDataLoad,
  p(1, 4n),
  op.callDataLoad,
  p(32, transferTopic),
  p(1, 32n),
  p(1, 0n),
  op.log3,
  p(1, 1n),
  ...returnWord,
];

// Jumps to `mark` when the selector, kept under the top of the stack, is `selector`.
function route(selector: bigint, mark: string): readonly Item[] {
  return [op.dup1, p(4, selector), op.eq, { to: mark }, op.jumpI];
}

/**
 * The runtime code of the crash chain's USDT: an ERC-20 with `balanceOf`, `transfer`, `approve`,
 * `allowance` and `transferFrom`, each holder's units in the storage slot of its own address and
 * each allowance in the slot of the hash of its owner and spender, and a Transfer log per
 * transfer, as the simulator's transfer traces read them.
 */
export const crashTokenCode: Hex = assemble([
  p(1, 0n),
  op.callDataLoad,
  p(1, 0xe0n),
  op.shr,
  ...route(0x70a08231n, "balanceOf"),
  ...route(0xa9059cbbn, "transfer"),
  ...route(0x095ea7b3n, "approve"),
  ...route(0xdd62ed3en, "allowance"),
  ...route(0x23b872ddn, "transferFrom"),
  p(1, 0n),
  op.dup1,
  op.revert,
  { mark: "balanceOf" },
  p(1, 4n),
  op.callDataLoad,
  op.sload,
  ...returnWord,
  ...transfer,
  ...approve,
  ...allowance,
  ...transferFrom,
  ...fail,
]);
