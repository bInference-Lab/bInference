import { writtenWordsOf } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { type CreateCall, createCallData } from "../contracts/launch-call.js";
import { createCallFor, readCreateCall } from "./create-call.js";

const settings = {
  creatorFeeRecipient: "0x00000000000000000000000000000000000000AA",
  pictureLink: "ipfs://bafkreig7wwicvvvzrbrcgs62ybg7yc7f7ay6s6yhsgpxcxvan5owbcfefm",
} as const;

const terms = {
  name: "Moon Cat",
  symbol: "MCAT",
  words: writtenWordsOf({ description: "A cat", links: { x: "https://x.com/mooncat" } }),
  pairToken: "0x0000000000000000000000000000000000000000",
  economics: `0x${"be".repeat(32)}`,
  salt: `0x${"01".repeat(32)}`,
  firstBuy: {
    quoteIn: 10n ** 17n,
    minimum: 1_000n,
    recipient: "0x000000000000000000000000000000000000bEEF",
  },
} as const;

const call = createCallFor(terms, settings);

// The create call with its token's parameters changed.
const withParams = (params: Partial<CreateCall["params"]>): CreateCall => ({
  ...call,
  params: { ...call.params, ...params },
});

describe("a geniusfun create call as the venue reads it back", () => {
  it("reads the terms and settings a call it builds writes", () => {
    expect(readCreateCall(createCallData(call))).toStrictEqual({ terms, settings });
  });

  it("calls the selectors the launchpad's docs name: launchAndBuy, and launchToken alone", () => {
    const { firstBuy: _firstBuy, ...alone } = terms;
    expect(createCallData(call).slice(0, 10)).toBe("0x71b27635");
    expect(createCallData(createCallFor(alone, settings)).slice(0, 10)).toBe("0xe78b4707");
  });

  it("reads a launch with no first buy, which the factory makes alone", () => {
    const { firstBuy: _firstBuy, ...alone } = terms;
    expect(readCreateCall(createCallData(createCallFor(alone, settings)))).toStrictEqual({
      terms: alone,
      settings,
    });
  });

  it.each<[string, CreateCall]>([
    ["the Foundation chosen", { ...call, toFoundation: true }],
    ["another launch configuration", { ...call, configId: 1n }],
    ["a creator tax", withParams({ creatorTaxBps: 100 })],
    ["the buyback off", withParams({ buybackEnabled: false })],
    [
      "a Discord link",
      withParams({ socials: { ...call.params.socials, discord: "https://discord.gg/cat" } }),
    ],
    ["a Farcaster link", withParams({ socials: { ...call.params.socials, farcaster: "cat" } })],
  ])("refuses a call with %s", (_case, changed) => {
    expect(readCreateCall(createCallData(changed))).toBeUndefined();
  });

  it("refuses a call with bytes after it", () => {
    expect(readCreateCall(`${createCallData(call)}00`)).toBeUndefined();
  });
});
