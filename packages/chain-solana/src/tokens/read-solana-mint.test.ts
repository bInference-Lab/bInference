import { createManualClock } from "@binference/core/testing";
import type { Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import recorded from "../delivery/recorded/solana-usdc-fill.json" with { type: "json" };
import { createSolanaRpcClient } from "../rpc/create-solana-rpc-client.js";
import { createFakeSolanaHttp, jsonRpcAnswer } from "../testing/fake-solana-http.js";
import { readSolanaMint } from "./read-solana-mint.js";

const url = "https://node.invalid/";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
const mintAnswer = recorded.answers.find(({ method }) => method === "getAccountInfo")?.result;
const live = () => new AbortController().signal;

function rpcAnswering(result: object | null) {
  const http = createFakeSolanaHttp({ [url]: (_call, id) => jsonRpcAnswer(id, { result }) });
  return createSolanaRpcClient({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
  });
}

// The recorded USDC mint with other fields, as another mint's account would hold them.
function mintWith(info: object): object {
  const answer = mintAnswer as { value: { data: { parsed: { info: object } } } };
  const { data } = answer.value;
  const parsed = { ...data.parsed, info: { ...data.parsed.info, ...info } };
  return { ...answer, value: { ...answer.value, data: { ...data, parsed } } };
}

describe("reading a Solana mint", () => {
  it("reads USDC's program, decimals, supply and authorities, as the cluster answered", async () => {
    await expect(readSolanaMint(rpcAnswering(mintWith({})), usdc, live())).resolves.toStrictEqual({
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      program: "spl-token",
      decimals: 6,
      isInitialized: true,
      supply: 7_574_476_732_233_603n,
      mintAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG",
      freezeAuthority: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar",
    });
  });

  it("reads a mint no one can freeze or mint more of", async () => {
    const fixed = mintWith({ mintAuthority: null, freezeAuthority: null });
    await expect(readSolanaMint(rpcAnswering(fixed), usdc, live())).resolves.toMatchObject({
      mintAuthority: undefined,
      freezeAuthority: undefined,
    });
  });

  it.each([
    ["no account", { context: { slot: 1 }, value: null }],
    [
      "an account that is no mint",
      { context: { slot: 1 }, value: { owner: "x", data: ["", "base64"] } },
    ],
    ["a mint not yet initialized", mintWith({ isInitialized: false })],
  ])("refuses an address with %s", async (_case, result) => {
    await expect(readSolanaMint(rpcAnswering(result), usdc, live())).rejects.toMatchObject({
      code: "chain.not_a_mint",
    });
  });
});
