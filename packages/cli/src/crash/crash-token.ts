import { type Address, encodeAbiParameters, type Hex, keccak256 } from "viem";
import { assemble, fail, type Item, op, p, returnWord, transferTopic } from "./crash-assembler.js";

/**
 * The storage slot of `holder`'s units in a crash chain token: a Solidity mapping at slot 0, as a
 * simulation's balance override finds it.
 */
export function crashBalanceSlot(holder: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 0n]));
}

// A call data word at its offset, or the caller's own address.
function word(at: number | "caller"): readonly Item[] {
  return at === "caller" ? [op.caller] : [p(1, BigInt(at)), op.callDataLoad];
}

// The slot of the holder's units, from the call data word at its offset or the caller's address:
// keccak256 of the holder and slot 0.
function balanceSlot(holder: number | "caller"): readonly Item[] {
  return [
    ...word(holder),
    p(1, 0n),
    op.mstore,
    p(1, 0n),
    p(1, 32n),
    op.mstore,
    p(1, 64n),
    p(1, 0n),
    op.sha3,
  ];
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

// Takes the amount in the call data word at `amountAt` from the slot on top of the stack, or fails
// when it holds less.
function debit(amountAt: number): readonly Item[] {
  return [
    op.dup1,
    op.sload,
    ...word(amountAt),
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
}

// Adds the amount in the call data word at `amountAt` to the slot on top of the stack.
function credit(amountAt: number): readonly Item[] {
  return [op.dup1, op.sload, ...word(amountAt), op.add, op.swap1, op.sstore];
}

// Logs a Transfer of the amount at `amountAt` from `from` to the holder at `toAt`, answers true.
function logged(from: readonly Item[], toAt: number, amountAt: number): readonly Item[] {
  return [
    ...word(amountAt),
    p(1, 0n),
    op.mstore,
    ...word(toAt),
    ...from,
    p(32, transferTopic),
    p(1, 32n),
    p(1, 0n),
    op.log3,
    p(1, 1n),
    ...returnWord,
  ];
}

/**
 * A rule every move of a {@link crashTokenCodeOf} token keeps: no units move `into` the address,
 * as a honeypot keeps every sale out of its pool, or units move `onlyFrom` the address, as a token
 * whose buyers cannot pass on what they bought.
 */
export type CrashTokenRefusal =
  | { readonly kind: "into"; readonly address: Address }
  | { readonly kind: "onlyFrom"; readonly address: Address };

// Jumps to `fail` when a move breaks the refusal: its recipient is the refused address, or its
// sender is not the one address that may move units.
function refused(
  refusal: CrashTokenRefusal | undefined,
  move: { readonly sender: readonly Item[]; readonly recipient: readonly Item[] },
): readonly Item[] {
  if (refusal === undefined) {
    return [];
  }
  const isInto = refusal.kind === "into";
  return [
    ...(isInto ? move.recipient : move.sender),
    p(20, BigInt(refusal.address)),
    op.eq,
    ...(isInto ? [] : [op.isZero]),
    { to: "fail" },
    op.jumpI,
  ];
}

// transfer(to, amount): moves the caller's units, logs Transfer, answers true.
function transferUnder(refusal: CrashTokenRefusal | undefined): readonly Item[] {
  return [
    { mark: "transfer" },
    ...refused(refusal, { sender: [op.caller], recipient: word(4) }),
    ...balanceSlot("caller"),
    ...debit(0x24),
    ...balanceSlot(4),
    ...credit(0x24),
    ...logged([op.caller], 4, 0x24),
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

// transferFrom(from, to, amount): moves units the owner let the caller move, logs Transfer,
// answers true.
function transferFromUnder(refusal: CrashTokenRefusal | undefined): readonly Item[] {
  return [
    { mark: "transferFrom" },
    ...refused(refusal, { sender: word(4), recipient: word(0x24) }),
    ...allowanceSlot(4, "caller"),
    ...debit(0x44),
    ...balanceSlot(4),
    ...debit(0x44),
    ...balanceSlot(0x24),
    ...credit(0x44),
    ...logged(word(4), 0x24, 0x44),
  ];
}

// mint(to, amount), for `minter` alone: adds to the holder's units and logs a Transfer from the
// zero address, as a launch's token pays its first buy out.
function mintFor(minter: Address): readonly Item[] {
  return [
    { mark: "mint" },
    op.caller,
    p(20, BigInt(minter)),
    op.eq,
    op.isZero,
    { to: "fail" },
    op.jumpI,
    ...balanceSlot(4),
    ...credit(0x24),
    ...logged([p(1, 0n)], 4, 0x24),
  ];
}

// Jumps to `mark` when the selector, kept under the top of the stack, is `selector`.
function route(selector: bigint, mark: string): readonly Item[] {
  return [op.dup1, p(4, selector), op.eq, { to: mark }, op.jumpI];
}

/**
 * The runtime code of an ERC-20 of the crash chain: `balanceOf`, `transfer`, `approve`,
 * `allowance` and `transferFrom`, each holder's units at {@link crashBalanceSlot} and each
 * allowance in the slot of the hash of its owner and spender, and a Transfer log per transfer, as
 * the simulator's transfer traces read them. With a `minter`, as a launch's token behind a minimal
 * proxy, also `mint(to, amount)` that only the minter, its launchpad, may call. With a `refusal`,
 * every `transfer` and `transferFrom` that breaks it reverts.
 */
export function crashTokenCodeOf(minter?: Address, refusal?: CrashTokenRefusal): Hex {
  return assemble([
    p(1, 0n),
    op.callDataLoad,
    p(1, 0xe0n),
    op.shr,
    ...route(0x70a08231n, "balanceOf"),
    ...route(0xa9059cbbn, "transfer"),
    ...route(0x095ea7b3n, "approve"),
    ...route(0xdd62ed3en, "allowance"),
    ...route(0x23b872ddn, "transferFrom"),
    ...(minter === undefined ? [] : route(0x40c10f19n, "mint")),
    p(1, 0n),
    op.dup1,
    op.revert,
    { mark: "balanceOf" },
    ...balanceSlot(4),
    op.sload,
    ...returnWord,
    ...transferUnder(refusal),
    ...approve,
    ...allowance,
    ...transferFromUnder(refusal),
    ...(minter === undefined ? [] : mintFor(minter)),
    ...fail,
  ]);
}

/** The runtime code of the crash chain's USDT: {@link crashTokenCodeOf} with no minter. */
export const crashTokenCode: Hex = crashTokenCodeOf();
