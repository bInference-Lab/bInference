import { assetRefSchema, chainRefSchema } from "@binference/chain";
import type { HttpResponse } from "@binference/core";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import {
  boostedAddresses,
  boostedTokensAnswer,
  noPairsAnswer,
  topBoostsAnswer,
  wbnbAddress,
  wbnbPairsAnswer,
} from "@binference/dexscreener/testing";
import { marketReadsContract } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { selfHostedMarketReads } from "./market-reads.js";

const live = { signal: new AbortController().signal };
const origin = "https://api.dexscreener.com";
const unknownAddress = "0x000000000000000000000000000000000000dEaD";
const tokenOf = (address: string) => assetRefSchema.parse(`eip155:56/erc20:${address}`);

function answer(body: string): HttpResponse {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

// DEX Screener's recorded answers, at the URLs the reads ask.
const recorded = createScriptedHttp([
  {
    method: "GET",
    url: `${origin}/token-pairs/v1/bsc/${wbnbAddress}`,
    response: answer(wbnbPairsAnswer),
  },
  {
    method: "GET",
    url: `${origin}/token-pairs/v1/bsc/${unknownAddress}`,
    response: answer(noPairsAnswer),
  },
  { method: "GET", url: `${origin}/token-boosts/top/v1`, response: answer(topBoostsAnswer) },
  {
    method: "GET",
    url: `${origin}/tokens/v1/bsc/${boostedAddresses.join(",")}`,
    response: answer(boostedTokensAnswer),
  },
]);

const readsOver = (http = recorded) => selfHostedMarketReads({ http, clock: createManualClock(0) });

describe("self-hosted market reads", () => {
  it.each(
    marketReadsContract({
      create: () => ({
        reads: readsOver(),
        known: tokenOf(wbnbAddress),
        unknown: tokenOf(unknownAddress),
        down: readsOver(createScriptedHttp([])),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads DEX Screener on BNB Smart Chain and nowhere else", async () => {
    const http = createScriptedHttp([]);
    const reads = readsOver(http);
    await expect(reads.pools(tokenOf(wbnbAddress), live)).resolves.toStrictEqual({
      ok: false,
      error: "source_down",
    });
    await expect(reads.trending(chainRefSchema.parse("eip155:1"), live)).resolves.toStrictEqual({
      ok: false,
      error: "no_data",
    });
    expect(http.requests().map(({ url }) => url)).toStrictEqual([
      `${origin}/token-pairs/v1/bsc/${wbnbAddress}`,
    ]);
  });

  it("names DEX Screener as the source of what it reads", async () => {
    await expect(
      readsOver().trending(chainRefSchema.parse("eip155:56"), live),
    ).resolves.toMatchObject({
      ok: true,
      value: { source: "dexscreener", items: [{ asset: tokenOf(boostedAddresses[0]) }, {}] },
    });
  });
});
