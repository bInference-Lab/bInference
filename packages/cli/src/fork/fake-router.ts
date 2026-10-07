import { type Address, concat, type Hex, numberToHex, size } from "viem";

/** Tokens a fake router takes from its caller through an allowance the caller left it. */
export interface HiddenPull {
  readonly token: Address;
  readonly to: Address;
  readonly base: bigint;
}

// EVM opcodes the fake router uses.
const op = {
  stop: "0x00",
  isZero: "0x15",
  shiftLeft: "0x1b",
  caller: "0x33",
  callValue: "0x34",
  callDataSize: "0x36",
  callDataCopy: "0x37",
  memoryStore: "0x52",
  jumpIf: "0x57",
  gas: "0x5a",
  jumpDest: "0x5b",
  call: "0xf1",
  revert: "0xfd",
} as const satisfies Record<string, Hex>;

const transferFromSelector = 0x23b872ddn;

// PUSH1 to PUSH32: the opcode 0x5f + n, then the value in n bytes.
function push(bytes: number, value: bigint | Address): Hex {
  return concat([
    numberToHex(0x5f + bytes, { size: 1 }),
    numberToHex(BigInt(value), { size: bytes }),
  ]);
}

// The call at the top of the stack failed: jump to the revert.
function revertOnFailure(fail: number): readonly Hex[] {
  return [op.isZero, push(2, BigInt(fail)), op.jumpIf];
}

// transferFrom(caller, pull.to, pull.base) on pull.token, built in memory from offset 0.
function pullCode(pull: HiddenPull, fail: number): readonly Hex[] {
  return [
    push(4, transferFromSelector),
    push(1, 224n),
    op.shiftLeft,
    push(1, 0n),
    op.memoryStore,
    op.caller,
    push(1, 0x04n),
    op.memoryStore,
    push(20, pull.to),
    push(1, 0x24n),
    op.memoryStore,
    push(32, pull.base),
    push(1, 0x44n),
    op.memoryStore,
    // CALL(gas, token, 0, 0, 100, 0, 0)
    push(1, 0n),
    push(1, 0n),
    push(1, 0x64n),
    push(1, 0n),
    push(1, 0n),
    push(20, pull.token),
    op.gas,
    op.call,
    ...revertOnFailure(fail),
  ];
}

// The caller's calldata and value, passed on to the router as they came.
function forwardCode(router: Address, fail: number): readonly Hex[] {
  return [
    op.callDataSize,
    push(1, 0n),
    push(1, 0n),
    op.callDataCopy,
    // CALL(gas, router, callvalue, 0, calldatasize, 0, 0)
    push(1, 0n),
    push(1, 0n),
    op.callDataSize,
    push(1, 0n),
    op.callValue,
    push(20, router),
    op.gas,
    op.call,
    ...revertOnFailure(fail),
    op.stop,
  ];
}

/**
 * The runtime code of a router for fork tests: it passes each call on to a real router with its
 * value and calldata, so a swap through it pays the caller as the real router would. With a
 * hidden pull it also moves the caller's tokens elsewhere first, through an allowance the caller
 * gave it earlier: a transfer the call's own bytes never show. Any failed call reverts.
 */
export function fakeRouterCode(router: Address, pull?: HiddenPull): Hex {
  const body = (fail: number): readonly Hex[] => [
    ...(pull === undefined ? [] : pullCode(pull, fail)),
    ...forwardCode(router, fail),
  ];
  // Every jump is a PUSH2, so the body's size does not depend on where the revert lands.
  const fail = size(concat([...body(0)]));
  return concat([...body(fail), op.jumpDest, push(1, 0n), push(1, 0n), op.revert]);
}
