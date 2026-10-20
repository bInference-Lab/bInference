import { accountRefSchema, assetRefSchema, type LaunchTerms } from "@binference/plugin-sdk";
import { decodeEvmDraft, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { draftAt, successOf } from "@binference/plugin-sdk/testing";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { recordedCid } from "../testing/flap-api-fake.js";
import { launchPartsOver, testLaunch, testOwner } from "../testing/launch-fixtures.js";
import { bnb, bscChain, recordedWallet, usdt } from "../testing/portal-fixtures.js";
import { decodeLaunch } from "./decode-launch.js";
import { flapLaunchOptions } from "./launch-settings.js";
import { launchStepsOf, placeOf } from "./launch-steps.js";

const salt = "0xfa46d944e827c386aa1f9207cbd6e50a331ca1d51228261ac83939d2a0119f0a";

// The steps of a launch with the recorded metadata and the salt a BSC launch used.
function stepsOf(terms: LaunchTerms) {
  const parts = launchPartsOver();
  const placed = placeOf(terms, parts);
  if (placed === undefined) {
    throw new Error("Flap does not launch this here.");
  }
  return { parts, built: launchStepsOf(terms, placed, { meta: recordedCid, salt }) };
}

describe("a Flap create call's decoding", () => {
  it("reads the token, the first buy for the caller with no minimum, and every setting", () => {
    const { parts, built } = stepsOf(testLaunch);
    const create = draftAt(built.steps, 0);
    expect(successOf(decodeEvmDraft(create)).value).toBe(parseEther("0.1"));
    expect(successOf(decodeLaunch(create, parts))).toStrictEqual({
      token: assetRefSchema.parse(`${bscChain}/erc20:0x01D47b3fDF1E9CaA63c69c6F0B08449a89417777`),
      name: "Moon Cat",
      symbol: "MCAT",
      metadataUri: recordedCid,
      pair: bnb,
      feeBase: 0n,
      firstBuy: { spend: testLaunch.firstBuy, minOut: 0n, recipient: recordedWallet },
      options: { ...testLaunch.options, taxRecipient: testOwner },
    });
  });

  it("reads back each setting the launcher declares, and no other", () => {
    const { parts, built } = stepsOf(testLaunch);
    const { options } = successOf(decodeLaunch(draftAt(built.steps, 0), parts));
    expect(Object.keys(options).toSorted()).toStrictEqual(
      flapLaunchOptions.map((option) => option.name).toSorted(),
    );
  });

  it("approves the Portal for exactly a USDT first buy before the create call", () => {
    const terms = { ...testLaunch, pair: usdt, firstBuy: { asset: usdt, base: 7n } };
    const { parts, built } = stepsOf(terms);
    expect(built.steps).toHaveLength(2);
    expect(successOf(decodeLaunch(draftAt(built.steps, 1), parts)).firstBuy).toStrictEqual({
      spend: { asset: usdt, base: 7n },
      minOut: 0n,
      recipient: recordedWallet,
    });
  });

  it("refuses a call that is no create call, and one that pays less than its coin first buy", () => {
    const { parts, built } = stepsOf(testLaunch);
    const create = successOf(decodeEvmDraft(draftAt(built.steps, 0)));
    const to = accountRefSchema.parse(`${bscChain}:${create.to}`);
    const short = encodeEvmDraft({ from: recordedWallet, to, value: 1n, data: create.data });
    const swap = encodeEvmDraft({ from: recordedWallet, to, value: 0n, data: "0x12345678" });
    expect(decodeLaunch(short, parts)).toStrictEqual({ ok: false, error: "unknown_call" });
    expect(decodeLaunch(swap, parts)).toStrictEqual({ ok: false, error: "unknown_call" });
  });
});
