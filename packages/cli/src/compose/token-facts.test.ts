import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains } from "./open-engine-parts.js";
import { chainTokenCode } from "./token-facts.js";

const bscRef = chainRefSchema.parse(bsc.id);
const signal = new AbortController().signal;
const url = "https://node.example.org/";
const token = assetRefSchema.parse(`${bsc.id}/erc20:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82`);

// The chain reads over one node that answers `eth_getCode` with `code`.
function readsAnswering(code: string) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: code });
  const response = { status: 200, headers: {}, body };
  const http = createScriptedHttp([{ method: "POST", url, response }]);
  const config = {
    enabled: [bscRef],
    rpc: { [bscRef]: { urls: [url] } },
    relays: {},
    maxFeePerGasGwei: { [bscRef]: "1" },
  };
  const clock = createManualClock(0);
  return { reads: composeChainReads({ chains: selfHostedChains(), config, http, clock }), http };
}

describe("the self-hosted read of a token's code", () => {
  it("asks the token's chain whether its address holds code", async () => {
    const contract = readsAnswering("0x6080604052");
    await expect(chainTokenCode(contract.reads)(token, { signal })).resolves.toBe(true);
    expect(contract.http.requests()).toHaveLength(1);
    const empty = readsAnswering("0x");
    await expect(chainTokenCode(empty.reads)(token, { signal })).resolves.toBe(false);
  });

  it("refuses a token on a chain it does not read, which it cannot show new", async () => {
    const { reads } = readsAnswering("0x");
    const other = assetRefSchema.parse("fake:1/erc20:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82");
    await expect(chainTokenCode(reads)(other, { signal })).rejects.toMatchObject({
      code: "cli.token_unreadable",
    });
  });
});
