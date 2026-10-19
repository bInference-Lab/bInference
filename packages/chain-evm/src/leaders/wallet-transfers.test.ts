import { isTxHash, type TxHash } from "@binference/chain";
import { getAddress, type Hex, pad, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { ChainLog } from "./chain-block.schema.js";
import { transferTopic, walletTransfersOf } from "./wallet-transfers.js";

const wallet = getAddress("0x1a00000000000000000000000000000000000001");
const stranger = getAddress("0x1a00000000000000000000000000000000000002");
const token = getAddress("0x2b00000000000000000000000000000000000001");
const hash = `0x${"ab".repeat(32)}`;
const txHash: TxHash = isTxHash(hash) ? hash : ("0x" as TxHash);
const topicOf = (address: Hex): Hex => pad(address, { size: 32 });

function logOf(changes: Partial<ChainLog> = {}): ChainLog {
  return {
    address: token,
    topics: [transferTopic, topicOf(stranger), topicOf(wallet)],
    data: pad(toHex(5n), { size: 32 }),
    blockNumber: 3n,
    blockHash: `0x${"cd".repeat(32)}`,
    transactionHash: txHash,
    logIndex: 1,
    removed: false,
    ...changes,
  };
}

describe("wallet transfers", () => {
  it("reads only ERC-20 transfers of a tracked wallet that are still on the chain", () => {
    const received = [
      logOf(),
      logOf({ removed: true }),
      logOf({ topics: [transferTopic, topicOf(stranger), topicOf(wallet), topicOf(token)] }),
      logOf({ data: "0x05" }),
      logOf({ topics: [transferTopic, topicOf(wallet), topicOf(stranger)] }),
      logOf({ topics: [`0x${"00".repeat(32)}`, topicOf(stranger), topicOf(wallet)] }),
      logOf({ topics: [transferTopic, "0x01", topicOf(wallet)] }),
    ];
    const found = walletTransfersOf({ sent: [], received }, new Set([wallet]), 100);
    expect(found).toStrictEqual({
      transfers: [{ account: wallet, block: 3n, txHash, logIndex: 1, token, delta: 5n }],
      overflows: [],
    });
  });

  it("orders a span's transfers by block, then by log", () => {
    const sent = [
      logOf({
        blockNumber: 4n,
        logIndex: 0,
        topics: [transferTopic, topicOf(wallet), topicOf(stranger)],
      }),
      logOf({
        blockNumber: 3n,
        logIndex: 9,
        topics: [transferTopic, topicOf(wallet), topicOf(stranger)],
      }),
    ];
    const received = [logOf({ blockNumber: 3n, logIndex: 2 })];
    const found = walletTransfersOf({ sent, received }, new Set([wallet]), 100);
    expect(found.transfers.map(({ block, logIndex }) => [block, logIndex])).toStrictEqual([
      [3n, 2],
      [3n, 9],
      [4n, 0],
    ]);
  });
});
