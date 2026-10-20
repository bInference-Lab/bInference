import { assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { riskDocument } from "../intents/intent-documents.schema.js";
import { testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { noticeText } from "../surfaces/notice-text.js";
import {
  copyGraceMs,
  copyStartOf,
  copyStateDocument,
  type CopyTaking,
  takenState,
} from "./copy-state.js";
import { fillNotice, skippedNotice } from "./fill-notices.js";
import { testLeaderTx } from "./test-copies.js";
import { testCopy, testLeader } from "./test-orders.js";

const chains = testChains();
const chinese = { formatter: createFormatter({ locale: "zh", timeZone: "UTC" }), chains };
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const book = [{ account: testLeader, label: "Whale" }];

// The icons of spec 4, built from their code points: no emoji sits in code.
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const done = String.fromCodePoint(0x2705);
const paper = String.fromCodePoint(0x1f9ea);

// A copy order that took `taking`.
function copying(taking: Omit<CopyTaking, "take">) {
  const triggerState = copyStateDocument.encode(takenState(copyStartOf(0), taking));
  return {
    agentId: testAgent,
    kind: "copy",
    isPaper: true,
    request: testCopy(),
    triggerState,
  } as const;
}

const honeyBuy = copying({
  id: 3,
  txHash: testLeaderTx,
  side: "buy",
  asset: unlisted,
  atMs: 0,
  facts: { symbol: "HONEY", name: "Honey", decimals: 18, verified: false },
});
const tokenSale = copying({
  id: 4,
  txHash: testLeaderTx,
  side: "sell",
  asset: testToken,
  atMs: 0,
  shareSoldBps: bpsSchema.parse(4_000),
  facts: { symbol: "TKN", name: "Test token", decimals: 6, verified: true },
});
const sold = {
  amountIn: { asset: testToken, base: 2_000_000n },
  amountOut: { asset: testCoin, base: 10n ** 15n },
  atMs: 1,
  soldPrice: { numerator: 4n, denominator: 5n },
};

describe("a copy order's notices in Chinese", () => {
  it("carry the risk check's warning on a copy buy, and no line on a pass", () => {
    const warned = { verdict: "warn", flags: [{ code: "high_tax", source: "measured" }] } as const;
    const risk = riskDocument.encode({ ...warned, onCurve: false, checkedAt: 0 });
    const passed = riskDocument.encode({
      verdict: "pass",
      flags: [],
      onCurve: false,
      checkedAt: 0,
    });
    const soldPrice = { numerator: 2n, denominator: 10n ** 9n };
    const amountOut = { asset: unlisted, base: 10n ** 18n };
    const bought = { ...sold, amountIn: sold.amountOut, amountOut, soldPrice };
    const skip = skippedNotice(honeyBuy, { reason: "no_route", risk });
    const fill = fillNotice(honeyBuy, bought, { decimals: 18, assets: {}, book, risk });
    const clean = fillNotice(honeyBuy, bought, { decimals: 18, assets: {}, book, risk: passed });

    expect(noticeText(skip, chinese)).toBe(
      `${warning} 跟单 0x00000009 买入 HONEY 0x0000000f 的交易已跳过：找不到此交易的路由。订单仍然有效。\n${warning} 风险检查对该代币发出了警告（high_tax）；订单的上限限制了跟单可能的损失。`,
    );
    expect(noticeText(fill, chinese)).toBe(
      `${paper} ${done} 跟单已成交：跟单 Whale：用 $2.00 买入 1 HONEY（0x0000000f）\n${warning} 风险检查对该代币发出了警告（high_tax）；订单的上限限制了跟单可能的损失。`,
    );
    expect(noticeText(clean, chinese)).toBe(
      `${paper} ${done} 跟单已成交：跟单 Whale：用 $2.00 买入 1 HONEY（0x0000000f）`,
    );
  });

  it("name the leader's trade and its token in a skip", () => {
    const notice = skippedNotice(honeyBuy, { reason: "honeypot" });

    expect(noticeText(notice, chinese)).toBe(
      `${warning} 跟单 0x00000009 买入 HONEY 0x0000000f 的交易已跳过：该代币疑似貔貅盘：你可能无法卖出。订单仍然有效。`,
    );
  });

  it("tell a copied sale with the leader's share", () => {
    const notice = fillNotice(tokenSale, sold, { decimals: 6, assets: {}, book });

    expect(noticeText(notice, chinese)).toBe(
      `${paper} ${done} 跟单已成交：跟单 Whale 卖出 40.00%：卖出 2 TKN，收到 $1.60`,
    );
  });

  it("tell a copied sale made past its minute as late, with when the leader sold", () => {
    const late = { ...sold, atMs: copyGraceMs + 1 };
    const notice = fillNotice(tokenSale, late, { decimals: 6, assets: {}, book });
    const when = chinese.formatter.dateTime(0);

    expect(noticeText(notice, chinese)).toBe(
      `${paper} ${done} 跟单已成交：跟单 Whale 于 ${when} 卖出的 40.00%，延后以当前价格执行：卖出 2 TKN，收到 $1.60`,
    );
  });
});
