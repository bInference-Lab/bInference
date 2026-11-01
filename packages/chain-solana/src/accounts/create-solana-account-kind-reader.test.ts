import type { AccountRef } from "@binference/chain";
import { accountKindReaderContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createSolanaRpcClient } from "../rpc/create-solana-rpc-client.js";
import type { SolanaChain } from "../solana-chain.js";
import {
  createFakeSolanaHttp,
  type FakeSolanaCall,
  jsonRpcAnswer,
} from "../testing/fake-solana-http.js";
import { createSolanaAccountKindReader } from "./create-solana-account-kind-reader.js";
import recorded from "./recorded/solana-account-kinds.json" with { type: "json" };

// Four accounts as Solana's public RPC answered for them (see the fixture's source).
const cluster = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const chain = { ref: cluster, name: "Solana", nativeAsset: `${cluster}/slip44:501` } as SolanaChain;
const on = (address: string) => `${cluster}:${address}` as AccountRef;
const wallet = on("F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe");
// Off the curve though the System Program owns it: no key can spend what it holds.
const offCurve = on("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T");
// A program-derived address of the SPL Token program, with no account.
const derived = on("XSiPBUQ4ejtQdM6RdFZ7GkMPDXgHrWkUFKbo7RYjjby");
const nonce = on("AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51");
const fresh = on("A9YsiCuAtY5RT3nfLKZTz2EuxxXf3FZogPqHkSH89SXT");
const program = on("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const tokenAccount = on("F8PbdmcRRihC98aEM3deRz8dvUc9UyQr4uVRzo41shQC");
const url = "https://node.invalid/";
const live = () => ({ signal: new AbortController().signal });

const answers = new Map(
  recorded.answers.map(({ method, params, result }) => [
    `${method}${JSON.stringify(params)}`,
    result,
  ]),
);

// A durable nonce account as the RPC answers one: the System Program's, with 80 bytes of data.
const nonceAccount = {
  context: { slot: 1 },
  value: {
    data: ["", "base64"],
    executable: false,
    lamports: 1_447_680,
    owner: "11111111111111111111111111111111",
    space: 80,
  },
};

function answer(call: FakeSolanaCall, id: string) {
  if (call.params[0] === "AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51") {
    return jsonRpcAnswer(id, { result: nonceAccount });
  }
  const result = answers.get(`${call.method}${JSON.stringify(call.params)}`);
  return result === undefined
    ? jsonRpcAnswer(id, { error: { code: -32_602, message: `not recorded: ${call.method}` } })
    : jsonRpcAnswer(id, { result });
}

function readerOf(endpoint = answer) {
  const http = createFakeSolanaHttp({ [url]: endpoint });
  const rpc = createSolanaRpcClient({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
  });
  return { reader: createSolanaAccountKindReader({ rpc, chain }), http };
}

// An account another program than the System Program owns, as a program-derived account is.
function derivedAnswer(call: FakeSolanaCall, id: string) {
  const value = {
    data: ["", "base64"],
    executable: false,
    lamports: 1_461_600,
    owner: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    space: 0,
  };
  return call.method === "getAccountInfo"
    ? jsonRpcAnswer(id, { result: { context: { slot: 1 }, value } })
    : jsonRpcAnswer(id, { error: { code: -32_602, message: "not recorded" } });
}

// An answer with no owner, which no account has.
function oddAnswer(call: FakeSolanaCall, id: string) {
  return jsonRpcAnswer(id, {
    result: { context: { slot: 1 }, value: { lamports: call.params.length } },
  });
}

describe("the Solana account kind reader", () => {
  it.each(
    accountKindReaderContract({
      create: async () =>
        await Promise.resolve({
          reader: readerOf().reader,
          wallet,
          fresh,
          program,
          tokenAccount,
          derived,
          nonce,
          stranger: "eip155:1:0x168E0c5AE6B259883D878C89C042ad6347F8ba85" as AccountRef,
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  // Solana's SDK leaves `finalized` out of the request: it is the node's default commitment.
  it("reads at the latest finalized slot and asks for no data", async () => {
    const { reader, http } = readerOf();
    await reader.read(wallet, live());
    expect(http.calls(url)).toStrictEqual([
      {
        method: "getAccountInfo",
        params: [
          "F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe",
          { encoding: "base64", dataSlice: { offset: 0, length: 0 } },
        ],
      },
    ]);
  });

  it("reads an account another program owns as no wallet", async () => {
    await expect(readerOf(derivedAnswer).reader.read(wallet, live())).resolves.toBe("not_wallet");
  });

  it("rejects an answer it cannot read as a retryable fault, never a wallet", async () => {
    await expect(readerOf(oddAnswer).reader.read(wallet, live())).rejects.toMatchObject({
      code: "chain.bad_answer",
      retryable: true,
    });
  });

  it("refuses an off-curve address the System Program owns, and reads nothing for it", async () => {
    const { reader, http } = readerOf();
    await expect(reader.read(offCurve, live())).resolves.toBe("not_wallet");
    expect(http.calls(url)).toStrictEqual([]);
  });
});
