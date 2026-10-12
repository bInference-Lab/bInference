import { createManualClock } from "@binference/core/testing";
import { encodeAbiParameters, getAddress, type Hex, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeEvmNode, type FakeRead } from "../testing/fake-evm-node.js";
import { createFakeRpcHttp } from "../testing/fake-rpc-http.js";
import { readTokenDecimals } from "./read-token-decimals.js";

const multicall = getAddress("0xca11bde05977b3631167028862be2a173976ca11");
const at = (byte: number) => getAddress(toHex(byte, { size: 20 }));
const signal = new AbortController().signal;
const word = (value: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [value]);

// Token 1 has 18 decimals, token 2 has 6, token 3 answers past a uint8, token 4 reverts, and
// token 5 burns its gas.
const answer = ({ target }: FakeRead): Hex | undefined | "burn" =>
  new Map<string, Hex | "burn">([
    [at(1), word(18n)],
    [at(2), word(6n)],
    [at(3), word(256n)],
    [at(5), "burn"],
  ]).get(target);

function rpcOver(node: ReturnType<typeof createFakeEvmNode>) {
  return createRpcFailover({
    endpoints: [{ name: "node", url: "https://node.test" }],
    http: createFakeRpcHttp({ "https://node.test": node.endpoint }),
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1,
  });
}

describe("token decimals", () => {
  it("reads every token's decimals in one batch, leaving out a token that answers none", async () => {
    const node = createFakeEvmNode({ multicall, head: 1n, answer });
    const rpc = rpcOver(node);
    const tokens = [at(1), at(2), at(3), at(4)];
    const decimals = await readTokenDecimals(rpc, { multicall, tokens, signal });
    expect(decimals).toStrictEqual(
      new Map([
        [at(1), 18],
        [at(2), 6],
      ]),
    );
    expect(node.batches()).toStrictEqual([{ block: "latest", calls: 4 }]);
    expect(node.gasLimits()).toStrictEqual([5_000_000n]);
    await expect(readTokenDecimals(rpc, { multicall, tokens: [], signal })).resolves.toStrictEqual(
      new Map(),
    );
  });

  it("leaves out a token whose decimals burn the batch's gas, and reads the rest", async () => {
    const node = createFakeEvmNode({ multicall, head: 1n, answer });
    const tokens = [at(1), at(5), at(2)];
    const decimals = await readTokenDecimals(rpcOver(node), { multicall, tokens, signal });
    expect(decimals).toStrictEqual(
      new Map([
        [at(1), 18],
        [at(2), 6],
      ]),
    );
  });
});
