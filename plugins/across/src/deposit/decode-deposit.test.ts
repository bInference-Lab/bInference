import { encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { type Address, encodeFunctionData, type Hex, pad, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { createAcrossBridge } from "../across-bridge.js";
import { recordedOptions, spokePool, wallet } from "../testing/bridge-fixtures.js";
import { usdcToBaseAnswer } from "../testing/recorded-quotes.js";
import {
  type DepositTerms,
  encodeDepositV3,
  readApiDeposit,
  readDepositV3,
} from "./deposit-call.js";

const unknownCall = { ok: false, error: "unknown_call" };
const apiDepositAbi = parseAbiItem(
  "function deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable",
);
const terms: DepositTerms = {
  depositor: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  inputToken: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  outputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  inputAmount: 20n * 10n ** 18n,
  outputAmount: 19_972_096n,
  destinationChainId: 8453n,
  exclusiveRelayer: "0x394311A6Aaa0D8E3411D8b62DE4578D41322d1bD",
  quoteTimestamp: 1_793_528_627,
  fillDeadline: 1_793_535_827,
  exclusivityParameter: 20,
  message: "0x",
};

function draftOf(data: Hex, value = 0n) {
  return encodeEvmDraft({ from: wallet, to: spokePool, value, data });
}

const word = (address: Address): Hex => pad(address);

// The API's `deposit` form of the terms, every account padded to 32 bytes.
function apiForm(deposit: DepositTerms, recipient: Hex = pad(deposit.recipient)): Hex {
  return encodeFunctionData({
    abi: [apiDepositAbi],
    functionName: "deposit",
    args: [
      word(deposit.depositor),
      recipient,
      word(deposit.inputToken),
      word(deposit.outputToken),
      deposit.inputAmount,
      deposit.outputAmount,
      deposit.destinationChainId,
      word(deposit.exclusiveRelayer),
      deposit.quoteTimestamp,
      deposit.fillDeadline,
      deposit.exclusivityParameter,
      deposit.message,
    ],
  });
}

describe("an Across deposit's bytes", () => {
  it("decode a depositV3 the bridge built to Base, its fill deadline in milliseconds", () => {
    expect(
      createAcrossBridge(recordedOptions()).decode(draftOf(encodeDepositV3(terms))),
    ).toStrictEqual({
      ok: true,
      value: {
        kind: "bound",
        contract: spokePool,
        depositor: wallet,
        recipient: "eip155:8453:0x2222222222222222222222222222222222222222",
        amountIn: {
          asset: "eip155:56/erc20:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
          base: terms.inputAmount,
        },
        minOut: {
          asset: "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          base: 19_972_096n,
        },
        fillDeadlineMs: 1_793_535_827_000,
      },
    });
  });

  it.each([
    ["a byte after the arguments", `${encodeDepositV3(terms)}00`, 0n],
    ["Across's own mark after the arguments", `${encodeDepositV3(terms)}73c0de`, 0n],
    ["a message that runs actions on arrival", encodeDepositV3({ ...terms, message: "0x01" }), 0n],
    [
      "another depositor than the wallet",
      encodeDepositV3({ ...terms, depositor: terms.recipient }),
      0n,
    ],
    [
      "a destination the bridge does not serve",
      encodeDepositV3({ ...terms, destinationChainId: 10n }),
      0n,
    ],
    ["the coin sent with it", encodeDepositV3(terms), 1n],
    ["the API's deposit with 32-byte values", apiForm(terms), 0n],
  ])("refuse %s as unknown_call", (_, data, value) => {
    expect(createAcrossBridge(recordedOptions()).decode(draftOf(data as Hex, value))).toStrictEqual(
      unknownCall,
    );
  });

  it("read the API's recorded deposit with Across's mark after it", () => {
    const answer: unknown = JSON.parse(usdcToBaseAnswer);
    const data = (answer as { swapTx: { data: Hex } }).swapTx.data;
    expect(data.endsWith("73c0de")).toBe(true);
    expect(readApiDeposit(data)).toStrictEqual(terms);
    expect(readDepositV3(encodeDepositV3(terms))).toStrictEqual(terms);
  });

  it("read no API deposit whose recipient is 32 bytes, such as a Solana account", () => {
    const solanaAccount = `0x${"7f".repeat(32)}` as const;
    expect(readApiDeposit(apiForm(terms, solanaAccount))).toBeUndefined();
  });
});
