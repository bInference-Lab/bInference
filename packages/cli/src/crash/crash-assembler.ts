import { concat, type Hex, keccak256, numberToHex, size, toHex } from "viem";

/** A small assembler's item: opcodes as bytes, pushes of a fixed width, jump targets and their labels. */
export type Item =
  | Hex
  | { readonly push: number; readonly value: bigint }
  | { readonly mark: string }
  | { readonly to: string };

/** A push of `value` in `bytes` bytes. */
export const p = (bytes: number, value: bigint): Item => ({ push: bytes, value });

function sizeOf(item: Item): number {
  if (typeof item === "string") {
    return size(item);
  }
  if ("push" in item) {
    return 1 + item.push;
  }
  return "mark" in item ? 1 : 3;
}

function pushed(bytes: number, value: bigint): Hex {
  return concat([numberToHex(0x5f + bytes, { size: 1 }), numberToHex(value, { size: bytes })]);
}

/** The bytecode of the items, each jump target resolved to its label's offset. */
export function assemble(items: readonly Item[]): Hex {
  const marks = new Map<string, number>();
  items.reduce((offset, item) => {
    if (typeof item !== "string" && "mark" in item) {
      marks.set(item.mark, offset);
    }
    return offset + sizeOf(item);
  }, 0);
  return concat(
    items.map((item): Hex => {
      if (typeof item === "string") {
        return item;
      }
      if ("push" in item) {
        return pushed(item.push, item.value);
      }
      return "mark" in item ? "0x5b" : pushed(2, BigInt(marks.get(item.to) ?? 0));
    }),
  );
}

/** The name of an EVM opcode the crash chain's contracts use. */
export type OpName =
  | "add"
  | "mul"
  | "sub"
  | "div"
  | "lt"
  | "eq"
  | "isZero"
  | "shl"
  | "shr"
  | "sha3"
  | "address"
  | "caller"
  | "callValue"
  | "callDataLoad"
  | "callDataCopy"
  | "timestamp"
  | "mload"
  | "mstore"
  | "sload"
  | "sstore"
  | "jump"
  | "jumpI"
  | "gas"
  | "dup1"
  | "dup2"
  | "dup3"
  | "dup5"
  | "swap1"
  | "log1"
  | "log3"
  | "call"
  | "create2"
  | "stop"
  | "return"
  | "revert";

/** The EVM opcodes the crash chain's contracts use, each as its byte. */
export const op: Readonly<Record<OpName, Hex>> = {
  add: "0x01",
  mul: "0x02",
  sub: "0x03",
  div: "0x04",
  lt: "0x10",
  eq: "0x14",
  isZero: "0x15",
  shl: "0x1b",
  shr: "0x1c",
  sha3: "0x20",
  address: "0x30",
  caller: "0x33",
  callValue: "0x34",
  callDataLoad: "0x35",
  callDataCopy: "0x37",
  timestamp: "0x42",
  mload: "0x51",
  mstore: "0x52",
  sload: "0x54",
  sstore: "0x55",
  jump: "0x56",
  jumpI: "0x57",
  gas: "0x5a",
  dup1: "0x80",
  dup2: "0x81",
  dup3: "0x82",
  dup5: "0x84",
  swap1: "0x90",
  log1: "0xa1",
  log3: "0xa3",
  call: "0xf1",
  create2: "0xf5",
  stop: "0x00",
  return: "0xf3",
  revert: "0xfd",
};

/** The topic of an ERC-20 `Transfer` log. */
export const transferTopic: bigint = BigInt(keccak256(toHex("Transfer(address,address,uint256)")));
/** Returns the word on top of the stack. */
export const returnWord: readonly Item[] = [p(1, 0n), op.mstore, p(1, 32n), p(1, 0n), op.return];
/** The `fail` label: reverts with no data. */
export const fail: readonly Item[] = [{ mark: "fail" }, p(1, 0n), op.dup1, op.revert];

/**
 * Takes `amount` of `token` from the caller to this contract by `transferFrom`, through the
 * allowance the caller left it, and jumps to `fail` when the call fails. Each pushes its word.
 */
export function pullFromCaller(token: readonly Item[], amount: readonly Item[]): readonly Item[] {
  return [
    p(4, 0x23b872ddn),
    p(1, 0xe0n),
    op.shl,
    p(1, 0n),
    op.mstore,
    op.caller,
    p(1, 4n),
    op.mstore,
    op.address,
    p(1, 0x24n),
    op.mstore,
    ...amount,
    p(1, 0x44n),
    op.mstore,
    p(1, 0x20n),
    p(1, 0n),
    p(1, 0x64n),
    p(1, 0n),
    p(1, 0n),
    ...token,
    op.gas,
    op.call,
    op.isZero,
    { to: "fail" },
    op.jumpI,
  ];
}
