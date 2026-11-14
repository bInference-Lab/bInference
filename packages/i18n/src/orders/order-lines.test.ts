import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { type OrderView, orderViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { orderLineText } from "./order-lines.js";

const at = 1_760_088_600_000;
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const token = assetRefSchema.parse("fake:1/erc20:0x00000000000000000000000000000000000000aa");
const unlisted = assetRefSchema.parse("fake:1/erc20:0x6982508145454Ce325dDbE47a25d4ec3d2311933");
const assets = { [token]: { symbol: "TKN", name: "Token", decimals: 18, verified: true } };
const display = { formatter: createFormatter({ locale: "en", timeZone: "UTC" }), assets };

// A stop-loss of the test token, with another kind, side or trigger when given.
function orderOf(request: object = {}): OrderView {
  return orderViewSchema.parse({
    order: "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    agent,
    wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    kind: "stopLoss",
    state: "active",
    request: {
      agent,
      kind: "stopLoss",
      token,
      side: "sell",
      size: { percentBps: 10_000 },
      trigger: { price: "550000000" },
      ...request,
    },
    fills: 1,
    expiresAt: at,
    createdAt: at,
    changedAt: at,
  });
}

describe("an auto order as every list of orders names it", () => {
  it("writes the trigger of every kind, with its fills and its end", () => {
    const leader = accountRefSchema.parse("fake:1:0x00000000000000000000000000000000000000d1");
    const lines = [
      orderOf(),
      orderOf({ kind: "limit", side: "buy", trigger: { price: "500000000", direction: "below" } }),
      orderOf({ kind: "trailing", trigger: { distanceBps: 500 } }),
      orderOf({ kind: "dca", side: "buy", trigger: { cron: "0 9 * * 1" } }),
      orderOf({
        kind: "copy",
        side: "buy",
        trigger: { leader, perBuyUsdMicros: "20000000", dailyUsdMicros: "200000000" },
      }),
    ].map((order) => orderLineText(order, display));
    const ends = "1 fill · ends Oct 10, 2025, 09:30:00";
    expect(lines).toStrictEqual([
      `Stop-loss · sell TKN · at $550.00 · ${ends}`,
      `Limit order · buy TKN · at or below $500.00 · ${ends}`,
      `Trailing stop · sell TKN · 5.00% from the best price · ${ends}`,
      `DCA · buy TKN · on the schedule 0 9 * * 1 · ${ends}`,
      `Copy trade · copying 0x0000…00d1 at up to $20.00 a buy · ${ends}`,
    ]);
  });

  it("names a token its page carries no info for by its short address", () => {
    expect(orderLineText(orderOf({ token: unlisted }), display)).toBe(
      "Stop-loss · sell 0x6982…1933 · at $550.00 · 1 fill · ends Oct 10, 2025, 09:30:00",
    );
  });
});
