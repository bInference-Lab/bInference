import { type Hex, size, slice } from "viem";
import { describe, expect, it } from "vitest";
import {
  buyPaths,
  dagCallData,
  type DagTerms,
  nativeToken,
  salePaths,
  usdtToken,
} from "../testing/dag-fixtures.js";
import {
  recordedCommissionBytes,
  recordedSaleCall,
  recordedSaleTerms,
} from "../testing/recorded-sale.js";
import { walletAddress } from "../testing/venue-fixtures.js";
import { type DagCall, readDagCall, withTerms } from "./dag-call.js";

const withoutCommission: Hex = slice(
  recordedSaleCall,
  0,
  size(recordedSaleCall) - recordedCommissionBytes,
);
const buy: DagTerms = {
  fromToken: nativeToken,
  toToken: usdtToken,
  amount: 10n ** 17n,
  minReturn: 70n * 10n ** 18n,
  deadlineSec: 1_791_486_800n,
  paths: buyPaths,
};
const sale: DagTerms = {
  fromToken: usdtToken,
  toToken: nativeToken,
  amount: 50n * 10n ** 18n,
  minReturn: 6n * 10n ** 16n,
  deadlineSec: 1_791_486_800n,
  paths: salePaths,
};

function mustRead(data: Hex, value: bigint): DagCall {
  const call = readDagCall(data, value, walletAddress);
  if (call === undefined) {
    throw new Error("The call does not read.");
  }
  return call;
}

describe("okx dag call", () => {
  it("reads a real sale through OKX's router once its commission is gone", () => {
    const call = readDagCall(withoutCommission, 0n, walletAddress);
    expect(call).toMatchObject({
      fromToken: usdtToken,
      toToken: nativeToken,
      recipient: recordedSaleTerms.receiver,
      amount: recordedSaleTerms.amount,
      minReturn: recordedSaleTerms.minReturn,
      deadlineSec: recordedSaleTerms.deadlineSec,
    });
  });

  it("refuses the real sale with its commission, which the router pays to an integrator", () => {
    expect(readDagCall(recordedSaleCall, 0n, walletAddress)).toBeUndefined();
  });

  it("reads a buy that pays its sender, with the native input as its value", () => {
    const call = readDagCall(dagCallData(buy), 10n ** 17n, walletAddress);
    expect(call).toMatchObject({
      fromToken: nativeToken,
      toToken: usdtToken,
      recipient: walletAddress,
      amount: 10n ** 17n,
      minReturn: 70n * 10n ** 18n,
      deadlineSec: 1_791_486_800n,
    });
  });

  it.each([
    ["a native input whose value falls short", dagCallData(buy), 10n ** 17n - 1n],
    ["a native input that sends more", dagCallData(buy), 10n ** 17n + 1n],
    ["a token input that sends the native coin", dagCallData(sale), 1n],
    [
      "a first node that pays from the router's balance",
      dagCallData({ ...sale, modeBits: 1n << 250n }),
      0n,
    ],
    ["a first node that pulls through Permit2", dagCallData({ ...sale, modeBits: 1n << 249n }), 0n],
    [
      "a receiver at the zero address",
      dagCallData({ ...sale, receiver: "0x0000000000000000000000000000000000000000" }),
      0n,
    ],
    [
      "another function",
      "0xa9059cbb0000000000000000000000004b0897b0513fdc7c541b6d9d7e929c4e5364d2db0000000000000000000000000000000000000000000000000000000000000001",
      0n,
    ],
    ["calldata cut short", slice(dagCallData(sale), 0, 100), 0n],
  ] as const)("refuses %s", (_label, data: Hex, value) => {
    expect(readDagCall(data, value, walletAddress)).toBeUndefined();
  });

  it.each([
    "3ca20afc2aaa",
    "3ca20afc2bbb",
    "22220afc2aaa",
    "22220afc2bbb",
    "88880afc2aaa",
    "88880afc2bbb",
    "777777771111",
    "777777772222",
  ])("refuses a call whose last word carries the fee flag %s", (flag) => {
    const data = dagCallData(sale);
    const flagged = `${data.slice(0, -64)}${flag}${data.slice(-52)}` as Hex;
    expect(readDagCall(flagged, 0n, walletAddress)).toBeUndefined();
  });

  it("reads a call whose last word carries no fee flag", () => {
    const data = dagCallData(sale);
    const marked = `${data.slice(0, -64)}123456789abc${data.slice(-52)}` as Hex;
    expect(readDagCall(marked, 0n, walletAddress)).toMatchObject({ amount: sale.amount });
  });

  it("refuses any bytes after the arguments", () => {
    expect(readDagCall(`${dagCallData(sale)}00`, 0n, walletAddress)).toBeUndefined();
  });

  it("encodes a new minimum and deadline and keeps every other argument", () => {
    const call = mustRead(dagCallData({ ...sale, receiver: walletAddress }), 0n);
    const terms = { minReturn: 7n * 10n ** 16n, deadlineSec: 1_791_483_260n };
    const data = withTerms(call, terms);
    expect(data).toBe(dagCallData({ ...sale, receiver: walletAddress, ...terms }));
    expect(readDagCall(data, 0n, walletAddress)).toMatchObject(terms);
  });
});
