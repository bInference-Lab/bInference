import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { type BridgeAction, bridgeDetailLines } from "./bridge-card-lines.js";

const usdt = assetRefSchema.parse("fake:1/token:0x0000000a");
const usdc = assetRefSchema.parse("fake:2/token:0x0000000b");
const recipient = accountRefSchema.parse("fake:2:0x000000e1");

const details = {
  minOut: { asset: usdc, base: 19_910_000n },
  fees: { asset: usdt, base: 90_000n },
  venue: "Relay",
  isChecksumless: false,
};

const action: BridgeAction = {
  amount: { asset: usdt, base: 20_000_000n },
  chain: "Fake Two",
  recipient,
  minutes: 2,
  details,
};

const keysOf = (bridge: BridgeAction): readonly string[] =>
  bridgeDetailLines(bridge).map((line) => line.key);

describe("a bridge card's detail lines", () => {
  it("shows what arrives, the fees and venue, and that binference reads the destination", () => {
    expect(keysOf(action)).toStrictEqual([
      "card.bridge.arrives",
      "card.bridge.fees",
      "card.bridge.read",
    ]);
  });

  it("asks the owner to check every character of an address with no checksum, last", () => {
    const checksumless = { ...details, isChecksumless: true };
    expect(keysOf({ ...action, details: checksumless })).toStrictEqual([
      "card.bridge.arrives",
      "card.bridge.fees",
      "card.bridge.read",
      "card.bridge.solana",
    ]);
  });

  it("shows a swap's rate after the fees on a route filled by a swap (decision 0323)", () => {
    const swapped = { ...details, swapRateBps: bpsSchema.parse(13) };
    const lines = bridgeDetailLines({ ...action, details: swapped });
    expect(lines[2]).toStrictEqual({
      key: "card.bridge.swapRate",
      values: { rate: { type: "percent", bps: 13 } },
    });
  });

  it("shows no detail lines for a bridge whose card holds none", () => {
    const { details: _details, ...bare } = action;
    expect(bridgeDetailLines(bare)).toStrictEqual([]);
  });
});
