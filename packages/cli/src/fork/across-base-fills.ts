import { filledAnswer } from "@binference/across/testing";
import { accountRefParts, chainRefSchema } from "@binference/chain";
import { baseMainnet } from "@binference/chains";
import { type JsonValue, jsonValueSchema } from "@binference/core";
import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Hex,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toHex,
} from "viem";
import { z } from "zod";
import { bridgeContractsOf } from "../compose/bridge-routes.js";
import type { RecordedChain } from "../compose/test-recorded-chain.js";

/** What Across's SpokePool logged for a deposit, as `FundsDeposited` names it. */
export interface AcrossDeposited {
  readonly hash: Hex;
  readonly inputToken: Hex;
  readonly outputToken: Hex;
  readonly inputAmount: bigint;
  readonly outputAmount: bigint;
  readonly depositId: bigint;
  readonly fillDeadline: number;
  readonly exclusivityDeadline: number;
  readonly depositor: Hex;
  readonly recipient: Hex;
  readonly exclusiveRelayer: Hex;
}

// The relayer of Across's recorded fill on Arbitrum One, which the fills here take for a test's
// deposits.
const recordedRelayer: Address = "0xfd03abcadaf3f930fa4e37eb2f6ea3a44a41b7f0";
const baseSpoke = bridgeContractsOf("across", "spoke-pool")[chainRefSchema.parse(baseMainnet.id)];
const baseSpokePool = getAddress(baseSpoke === undefined ? "" : accountRefParts(baseSpoke).address);

const fillEvents = parseAbi([
  "event FilledRelay(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 repaymentChainId, uint256 indexed originChainId, uint256 indexed depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 exclusiveRelayer, bytes32 indexed relayer, bytes32 depositor, bytes32 recipient, bytes32 messageHash, (bytes32 updatedRecipient, bytes32 updatedMessageHash, uint256 updatedOutputAmount, uint8 fillType) relayExecutionInfo)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const filledRelayData = parseAbiParameters(
  "bytes32, bytes32, uint256, uint256, uint256, uint32, uint32, bytes32, bytes32, bytes32, bytes32, (bytes32, bytes32, uint256, uint8)",
);
// Base's blocks the fill reads in: the fill's block, then the finalized and the latest heads.
const blocks = { fill: 0x2_5ff_f00n, final: 0x2_5ff_fe0n, latest: 0x2_600_000n };
const zeroWord = pad("0x0");

// The 20-byte address a 32-byte word of Across's holds.
const addressIn = (word: Hex): Address => getAddress(`0x${word.slice(-40)}`);

// Across's fill on Base for the deposit: the relayer's output token to the recipient, then
// `FilledRelay` naming the deposit's origin, id, depositor, recipient and amounts, as Across's
// SpokePool logs.
function fillLogs(deposited: AcrossDeposited) {
  const transfer = {
    address: addressIn(deposited.outputToken),
    topics: encodeEventTopics({
      abi: fillEvents,
      eventName: "Transfer",
      args: { from: recordedRelayer, to: addressIn(deposited.recipient) },
    }),
    data: pad(toHex(deposited.outputAmount)),
  };
  const { depositId, recipient, outputAmount } = deposited;
  const fill = {
    address: baseSpokePool,
    topics: encodeEventTopics({
      abi: fillEvents,
      eventName: "FilledRelay",
      args: { originChainId: 56n, depositId, relayer: pad(recordedRelayer) },
    }),
    data: encodeAbiParameters(filledRelayData, [
      deposited.inputToken,
      deposited.outputToken,
      deposited.inputAmount,
      outputAmount,
      8453n,
      deposited.fillDeadline,
      deposited.exclusivityDeadline,
      deposited.exclusiveRelayer,
      deposited.depositor,
      recipient,
      zeroWord,
      [recipient, zeroWord, outputAmount, 0],
    ]),
  };
  return [transfer, fill];
}

/** A transaction a test lands on Base: its hash, who sent it to which contract, and its logs. */
export interface BaseLanding {
  readonly hash: Hex;
  readonly from: Address;
  readonly to: Address;
  readonly logs: readonly {
    readonly address: Address;
    readonly topics: readonly JsonValue[];
    readonly data: Hex;
  }[];
}

/**
 * Lands a transaction on Base's recorded chain, as a bridge's fill lands: its receipt and
 * transaction in a block, and the heads that make that block final.
 */
export function landOnBase(base: RecordedChain, landing: BaseLanding): void {
  const { hash } = landing;
  const blockHash = keccak256(stringToHex(`base block of ${hash}`));
  const placed = { blockNumber: toHex(blocks.fill), blockHash, transactionHash: hash };
  const logs = landing.logs.map((log, index) =>
    Object.assign({}, log, placed, { transactionIndex: "0x0", logIndex: toHex(index) }),
  );
  const route = { from: landing.from, to: landing.to, transactionIndex: "0x0" };
  const fees = { gasUsed: "0x1a60c", effectiveGasPrice: "0x21a5eda", type: "0x2" };
  base.answer("eth_getTransactionReceipt", [hash], {
    ...placed,
    ...route,
    ...fees,
    status: "0x1",
    logs,
  });
  base.answer("eth_getTransactionByHash", [hash], { ...placed, ...route, hash, value: "0x0" });
  base.answer("eth_blockNumber", [], toHex(blocks.latest));
  const final = { number: toHex(blocks.final), hash: keccak256(stringToHex("base final")) };
  base.answer("eth_getBlockByNumber", ["finalized", false], final);
}

/**
 * Lands Across's fill of the deposit on Base's recorded chain: its receipt and transaction, and
 * the heads that make it final; answers the fill's hash.
 */
export function landBaseFill(base: RecordedChain, deposited: AcrossDeposited): Hex {
  const hash = keccak256(stringToHex(`across fill of ${deposited.hash}`));
  landOnBase(base, { hash, from: recordedRelayer, to: baseSpokePool, logs: fillLogs(deposited) });
  return hash;
}

/** Across's recorded status of a filled deposit, naming this deposit and its fill. */
export function acrossStatusOf(deposited: AcrossDeposited, fill: Hex): string {
  const recorded = z.record(z.string(), jsonValueSchema).parse(JSON.parse(filledAnswer));
  return JSON.stringify({
    ...recorded,
    depositId: String(deposited.depositId),
    depositTxHash: deposited.hash,
    depositTxnRef: deposited.hash,
    fillTx: fill,
    fillTxnRef: fill,
  });
}
