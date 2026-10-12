import { createManualClock } from "@binference/core/testing";
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  type Hex,
  stringToHex,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeEvmNode, type FakeRead } from "../testing/fake-evm-node.js";
import { createFakeRpcHttp } from "../testing/fake-rpc-http.js";
import { readTokenFacts } from "./read-token-facts.js";

const multicall = getAddress("0xca11bde05977b3631167028862be2a173976ca11");
const at = (byte: number): Address => getAddress(toHex(byte, { size: 20 }));
const signal = new AbortController().signal;
const word = (value: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [value]);
const text = (value: string): Hex => encodeAbiParameters([{ type: "string" }], [value]);

type Field = "symbol" | "name" | "decimals";
type Answers = Partial<Readonly<Record<Field, Hex | "burn">>>;

// Token 1 is a plain token; token 2 answers its symbol and name as `bytes32`; token 3 has no name;
// token 4 has no symbol; token 5 answers decimals past a uint8; token 6 answers an empty symbol;
// token 7 burns its gas; token 8 answers a symbol of 100 characters with a zero byte in it.
const tokens = new Map<Address, Answers>([
  [at(1), { symbol: text("XVS"), name: text("Venus"), decimals: word(18n) }],
  [
    at(2),
    {
      symbol: stringToHex("MKR", { size: 32 }),
      name: stringToHex("Maker", { size: 32 }),
      decimals: word(18n),
    },
  ],
  [at(3), { symbol: text("NONAME"), decimals: word(6n) }],
  [at(4), { name: text("No symbol"), decimals: word(18n) }],
  [at(5), { symbol: text("BIG"), name: text("Big"), decimals: word(256n) }],
  [at(6), { symbol: text(""), name: text("Empty"), decimals: word(18n) }],
  [at(7), { symbol: "burn", decimals: word(18n) }],
  [at(8), { symbol: text(`L\0${"O".repeat(99)}`), name: text("Long"), decimals: word(9n) }],
]);

function answer({ target, callData }: FakeRead): Hex | undefined | "burn" {
  const { functionName } = decodeFunctionData({ abi: erc20Abi, data: callData });
  const field: Field | undefined =
    functionName === "symbol" || functionName === "name" || functionName === "decimals"
      ? functionName
      : undefined;
  return field === undefined ? undefined : tokens.get(target)?.[field];
}

function rpcOver(node: ReturnType<typeof createFakeEvmNode>) {
  return createRpcFailover({
    endpoints: [{ name: "node", url: "https://node.test" }],
    http: createFakeRpcHttp({ "https://node.test": node.endpoint }),
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1,
  });
}

describe("token facts", () => {
  it("reads each token's symbol, name and decimals in one batch of three calls a token", async () => {
    const node = createFakeEvmNode({ multicall, head: 1n, answer });
    const facts = await readTokenFacts(rpcOver(node), {
      multicall,
      tokens: [at(1), at(2), at(3)],
      signal,
    });
    expect(facts).toStrictEqual(
      new Map([
        [at(1), { symbol: "XVS", name: "Venus", decimals: 18 }],
        [at(2), { symbol: "MKR", name: "Maker", decimals: 18 }],
        [at(3), { symbol: "NONAME", name: "NONAME", decimals: 6 }],
      ]),
    );
    expect(node.batches()).toStrictEqual([{ block: "latest", calls: 9 }]);
    expect(node.gasLimits()).toStrictEqual([10_000_000n]);
  });

  it("leaves out a token with no symbol, an empty one, or decimals past a uint8", async () => {
    const node = createFakeEvmNode({ multicall, head: 1n, answer });
    const facts = await readTokenFacts(rpcOver(node), {
      multicall,
      tokens: [at(4), at(5), at(6), at(9)],
      signal,
    });
    expect(facts).toStrictEqual(new Map());
  });

  it("leaves out a token that burns the batch's gas, and reads the rest", async () => {
    const node = createFakeEvmNode({ multicall, head: 1n, answer });
    const facts = await readTokenFacts(rpcOver(node), {
      multicall,
      tokens: [at(1), at(7)],
      signal,
    });
    expect([...facts.keys()]).toStrictEqual([at(1)]);
  });

  it("drops zero bytes and keeps 64 characters of a symbol", async () => {
    const node = createFakeEvmNode({ multicall, head: 1n, answer });
    const facts = await readTokenFacts(rpcOver(node), { multicall, tokens: [at(8)], signal });
    expect(facts.get(at(8))).toStrictEqual({
      symbol: `L${"O".repeat(63)}`,
      name: "Long",
      decimals: 9,
    });
  });

  it("asks nothing for no tokens, and rejects once the signal aborted", async () => {
    const node = createFakeEvmNode({ multicall, head: 1n, answer });
    const rpc = rpcOver(node);
    await expect(readTokenFacts(rpc, { multicall, tokens: [], signal })).resolves.toStrictEqual(
      new Map(),
    );
    const aborted = AbortSignal.abort(new Error("stopped"));
    await expect(
      readTokenFacts(rpc, { multicall, tokens: [at(1)], signal: aborted }),
    ).rejects.toThrow("stopped");
    expect(node.batches()).toStrictEqual([]);
  });
});
