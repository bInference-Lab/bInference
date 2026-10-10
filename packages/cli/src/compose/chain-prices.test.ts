import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { priceSourceContract } from "@binference/chain/testing";
import { bsc } from "@binference/chains";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { createFakePriceSource } from "@binference/engine/testing";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import { composePrices, priceRouterOf } from "./chain-prices.js";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains, selfHostedFeeds } from "./open-engine-parts.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const elsewhere = assetRefSchema.parse("fake:2/slip44:1");
const fake = chainRefSchema.parse("fake:1");
const bscRef = chainRefSchema.parse(bsc.id);
const signal = new AbortController().signal;

function router() {
  const price = { numerator: 600n, denominator: 10n ** 12n };
  return priceRouterOf(new Map([[fake, createFakePriceSource(new Map([[coin, price]]))]]));
}

describe("the self-hosted prices", () => {
  it.each(
    priceSourceContract({ create: () => ({ source: router(), known: coin, unknown: elsewhere }) }),
  )("routes each asset to its chain's source: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("prices nothing of a chain it has no source for, and refuses an aborted signal", async () => {
    await expect(router().usdPrice(elsewhere, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "no_price",
    });
    const reason = new Error("stopped");
    await expect(router().usdPrice(coin, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
  });

  it("reads BSC's coin from its feed over the chain's RPC, and asks nothing for another token", async () => {
    const nowSec = 1_800_000_000n;
    // latestRoundData: round 1 answered $600.00000000 at `nowSec`.
    const round = encodeAbiParameters(
      parseAbiParameters("uint80, int256, uint256, uint256, uint80"),
      [1n, 60_000_000_000n, nowSec, nowSec, 1n],
    );
    const answer = { jsonrpc: "2.0", id: 1, result: round };
    const response = { status: 200, headers: {}, body: JSON.stringify(answer) };
    const url = "https://node.example.org/";
    const http = createScriptedHttp([{ method: "POST", url, response }]);
    const config = {
      enabled: [bscRef],
      rpc: { [bscRef]: { urls: [url] } },
      relays: {},
      maxFeePerGasGwei: { [bscRef]: "1" },
    };
    const clock = createManualClock(Number(nowSec) * 1_000);
    const reads = composeChainReads({ chains: selfHostedChains(), config, http, clock });
    const prices = composePrices(reads, { feeds: selfHostedFeeds(), clock });
    const bnb = assetRefSchema.parse(`${bsc.id}/slip44:714`);
    await expect(prices.usdPrice(bnb, { signal })).resolves.toStrictEqual({
      ok: true,
      value: { numerator: 60_000_000_000n * 1_000_000n, denominator: 10n ** 8n * 10n ** 18n },
    });
    const cake = assetRefSchema.parse(`${bsc.id}/erc20:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82`);
    await expect(prices.usdPrice(cake, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "no_price",
    });
    expect(http.requests()).toHaveLength(1);
  });
});
