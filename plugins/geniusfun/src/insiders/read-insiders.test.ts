import { describe, expect, it } from "vitest";
import { scriptedChain } from "../testing/recorded-chain.js";
import {
  bnb,
  olderCreator,
  olderToken,
  partsOver,
  registryContracts,
  stackCreator,
  stackToken,
  usdt,
} from "../testing/venue-fixtures.js";
import { readInsiders } from "./read-insiders.js";

const live = (): AbortSignal => new AbortController().signal;
const receiptsMethod = "eth_getBlockReceipts";
const readFailed = { code: "geniusfun.read_failed" };
// The block a request the scripted chain was asked names: its hex number after the method.
const blockOf = (asked: string): string => asked.slice(receiptsMethod.length + 1);

describe("geniusfun insiders", () => {
  it.each([
    ["an m4.2 launch", stackToken, stackCreator],
    ["an m4.1 launch", olderToken, olderCreator],
  ] as const)("names the wallets %s exempted from its snipe tax", async (_case, token, creator) => {
    const insiders = await readInsiders(
      { token, contracts: registryContracts },
      partsOver(scriptedChain()),
      live(),
    );
    expect(insiders).toStrictEqual([creator]);
  });

  it("finds the launch's blocks in a few headers, and reads them once per launch", async () => {
    const rpc = scriptedChain();
    const parts = partsOver(rpc);
    const request = { token: stackToken, contracts: registryContracts };
    await readInsiders(request, parts, live());
    const read = rpc.asked.length;
    const headers = rpc.asked.filter((asked) => asked.startsWith("eth_getBlockByNumber"));
    await readInsiders(request, parts, live());
    expect(headers.length).toBeLessThanOrEqual(10);
    expect(rpc.asked.slice(read).filter((asked) => !asked.startsWith("eth_call"))).toStrictEqual(
      [],
    );
  });

  it("throws, and keeps nothing, when the launch second's blocks hold no exemption", async () => {
    const recorded = scriptedChain();
    const request = { token: stackToken, contracts: registryContracts };
    await readInsiders(request, partsOver(recorded), live());
    const blocks = recorded.asked.filter((asked) => asked.startsWith(receiptsMethod));
    const rpc = scriptedChain({ receipts: new Map(blocks.map((asked) => [blockOf(asked), [[]]])) });
    const parts = partsOver(rpc);
    await expect(readInsiders(request, parts, live())).rejects.toMatchObject(readFailed);
    await expect(readInsiders(request, parts, live())).rejects.toMatchObject(readFailed);
    const receiptReads = rpc.asked.filter((asked) => asked.startsWith(receiptsMethod));
    expect(receiptReads).toHaveLength(blocks.length * 2);
  });

  it.each([
    ["a token no stack made", usdt],
    ["the chain's coin", bnb],
  ])("names none for %s", async (_case, token) => {
    await expect(
      readInsiders({ token, contracts: registryContracts }, partsOver(scriptedChain()), live()),
    ).resolves.toStrictEqual([]);
  });
});
