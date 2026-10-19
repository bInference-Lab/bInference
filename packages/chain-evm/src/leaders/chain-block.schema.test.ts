import { describe, expect, it } from "vitest";
import { blockFactsSchema, blockHeaderSchema, chainLogSchema } from "./chain-block.schema.js";

const hash = `0x${"ab".repeat(32)}`;
const parent = `0x${"cd".repeat(32)}`;
const address = "0x1a00000000000000000000000000000000000001";

describe("chain block schemas", () => {
  it("reads a log with no removed flag as on the chain, its index and block as numbers", () => {
    const log = chainLogSchema.parse({
      address,
      topics: [hash],
      data: "0x",
      blockNumber: "0x10",
      blockHash: hash,
      transactionHash: hash,
      logIndex: "0x2",
    });
    expect(log).toMatchObject({ blockNumber: 16n, logIndex: 2, removed: false });
    expect(chainLogSchema.safeParse({ ...log, logIndex: "two" }).success).toBe(false);
  });

  it("reads a block's time in milliseconds, and a contract creation with no target", () => {
    const header = { number: "0x10", hash, parentHash: parent, timestamp: "0x3e8" };
    expect(blockHeaderSchema.parse(header)).toStrictEqual({
      number: 16n,
      hash,
      parentHash: parent,
      timestampMs: 1_000_000,
    });
    const creation = { hash, from: address, to: null, value: "0x0" };
    const facts = blockFactsSchema.parse({ ...header, transactions: [creation] });
    expect(facts.transactions).toStrictEqual([
      { hash, from: "0x1A00000000000000000000000000000000000001", value: 0n },
    ]);
  });
});
