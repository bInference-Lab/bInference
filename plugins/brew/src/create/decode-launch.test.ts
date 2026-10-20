import type { TxDraft } from "@binference/plugin-sdk";
import { decodeEvmDraft, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { createSeededRandom, successOf } from "@binference/plugin-sdk/testing";
import { getAddress, type Hex, parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { brewSetupsOf } from "../brew-setups.js";
import { launchCallData, readLaunchCall } from "../contracts/launch-call.js";
import { factoryChain, launchSimulator, testLaunch, usdt } from "../testing/launch-fixtures.js";
import { bnb, bscChain, wbnb } from "../testing/recorded-launches.js";
import { buildLaunch } from "./build-launch.js";
import { decodeLaunch } from "./decode-launch.js";
import { builtKeyOf, keepBuilt, launchPartsOf } from "./launch-parts.js";

const live = new AbortController().signal;
const setups = brewSetupsOf([{ chain: bscChain, nativeAsset: bnb, wrappedNative: wbnb }]);
const pairs = [
  { asset: bnb, decimals: 18, startBase: parseEther("8") },
  { asset: usdt, decimals: 18, startBase: parseEther("5000") },
];

function partsOf() {
  const chain = { chain: bscChain, rpc: factoryChain(), simulator: launchSimulator(), pairs };
  return launchPartsOf({ random: createSeededRandom(283), chains: [chain] }, setups);
}

const request = {
  ...testLaunch,
  picture: testLaunch.image,
  fee: { asset: bnb, base: 0n },
  firstBuyMinOut: parseEther("99"),
};

// A built launch's create call, its parts, and the call with its parameters changed and kept as
// if the launcher had built it so.
async function builtCall() {
  const parts = partsOf();
  const built = await buildLaunch(request, parts, live);
  const create = built.steps.at(-1);
  if (create === undefined) {
    throw new Error("The build made no create call.");
  }
  const call = decodeEvmDraft(create);
  const params = call.ok ? readLaunchCall(call.value.data) : undefined;
  if (!call.ok || params === undefined) {
    throw new Error("The create call cannot be read.");
  }
  const kept = parts.built.get(builtKeyOf(create));
  const changed = (data: Hex, value = call.value.value, to = call.value.to): TxDraft => {
    const draft = encodeEvmDraft({
      from: create.from,
      to: `${bscChain}:${to}` as TxDraft["from"],
      value,
      data,
    });
    if (kept !== undefined) {
      keepBuilt(parts, builtKeyOf(draft), kept);
    }
    return draft;
  };
  return { parts, built, create, params, changed };
}

describe("a Brew create call's decoder", () => {
  it("reads the launch back from the call's bytes", async () => {
    const { parts, built, create } = await builtCall();
    const decoded = successOf(decodeLaunch(create, parts));
    expect(decoded).toMatchObject({
      token: built.token,
      name: "Moon Cat",
      symbol: "MCAT",
      pair: bnb,
      feeBase: 0n,
      firstBuy: { spend: request.firstBuy, minOut: parseEther("99"), recipient: request.wallet },
      options: { ...testLaunch.options },
      words: { description: "A cat on the moon" },
    });
    expect(decoded.picture?.contentType).toBe("image/png");
  });

  // The host refuses a call whose settings are not the card's (`other_settings`), so the decoder
  // must read the fee recipient from the bytes, never echo the request's.
  it("reads a fee recipient changed in the bytes, not the request's", async () => {
    const { parts, params, changed } = await builtCall();
    const elsewhere = getAddress("0x00000000000000000000000000000000000000bb");
    const draft = changed(launchCallData({ ...params, creatorFeeRecipient: elsewhere }));
    expect(successOf(decodeLaunch(draft, parts)).options).toMatchObject({
      poolFeeRecipient: `${bscChain}:${elsewhere}`,
    });
  });

  it("refuses the same call sent to another contract than the factory", async () => {
    const { parts, params, changed } = await builtCall();
    const elsewhere = getAddress("0xd765972dD6a09Fa9c743b4708198A820FC5D31EE");
    const draft = changed(launchCallData(params), undefined, elsewhere);
    expect(decodeLaunch(draft, parts)).toStrictEqual({ ok: false, error: "unknown_call" });
  });

  it("refuses a call it never built", async () => {
    const { create } = await builtCall();
    expect(decodeLaunch(create, partsOf())).toStrictEqual({ ok: false, error: "unknown_call" });
  });

  it.each([
    ["another fee tier", { fee: 2_500 }],
    ["ranges of its own", { positions: [{ tickLower: 0, tickUpper: 200, bps: 10_000 }] }],
    ["another supply", { totalSupply: 10n ** 24n }],
    ["another starting tick", { initialTick: -186_400 }],
    ["a first buy minimum with no first buy", { initialBuyQuoteAmount: 0n }],
  ])("refuses a call with %s", async (_case, change) => {
    const { parts, params, changed } = await builtCall();
    const draft = changed(launchCallData({ ...params, ...change }));
    expect(decodeLaunch(draft, parts)).toStrictEqual({ ok: false, error: "unknown_call" });
  });

  it("refuses a call whose value is not its fee and its coin first buy, or with bytes after", async () => {
    const { parts, params, changed } = await builtCall();
    const data = launchCallData(params);
    expect(decodeLaunch(changed(data, 1n), parts)).toStrictEqual({
      ok: false,
      error: "unknown_call",
    });
    expect(decodeLaunch(changed(`${data}00`), parts)).toStrictEqual({
      ok: false,
      error: "unknown_call",
    });
  });
});
