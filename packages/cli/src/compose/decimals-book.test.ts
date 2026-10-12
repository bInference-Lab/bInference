import { type AssetRef, assetRefSchema } from "@binference/chain";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { decimalsBookOf } from "./decimals-book.js";

const tokenOf = (byte: string): AssetRef =>
  assetRefSchema.parse(`eip155:56/erc20:0x00000000000000000000000000000000000000${byte}`);
const signal = new AbortController().signal;

describe("the watched tokens' decimals", () => {
  it("reads each token once, asks again for one it could not read only 10 minutes later, and forgets the unwatched", async () => {
    const clock = createManualClock(0);
    const asked: (readonly AssetRef[])[] = [];
    const book = decimalsBookOf(async (tokens) => {
      asked.push(tokens);
      return await Promise.resolve(new Map([[tokenOf("01"), 18]]));
    }, clock);
    await book.read([tokenOf("01"), tokenOf("02")], signal);
    await clock.advance(15_000);
    await book.read([tokenOf("01"), tokenOf("02")], signal);
    expect(asked).toStrictEqual([[tokenOf("01"), tokenOf("02")]]);
    await clock.advance(585_000);
    await book.read([tokenOf("01"), tokenOf("02")], signal);
    expect(asked).toStrictEqual([[tokenOf("01"), tokenOf("02")], [tokenOf("02")]]);
    await book.read([tokenOf("02")], signal);
    expect(book.known).toStrictEqual(new Map());
  });
});
